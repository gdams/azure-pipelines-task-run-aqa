import * as fs from 'fs'
import * as path from 'path'

import * as taskLib from 'azure-pipelines-task-lib/task';
import * as toolLib from 'azure-pipelines-tool-lib/tool';

let tempDirectory = process.env['RUNNER_TEMP'] || ''
const IS_WINDOWS = process.platform === 'win32'

if (!tempDirectory) {
  let baseLocation

  if (IS_WINDOWS) {
    // On windows use the USERPROFILE env variable
    baseLocation = process.env['USERPROFILE'] || 'C:\\'
  } else if (process.platform === 'darwin') {
    baseLocation = '/Users'
  } else {
    baseLocation = '/home'
  }
  tempDirectory = path.join(baseLocation, 'actions', 'temp')
}

export async function runaqaTest(
  version: string,
  jdksource: string,
  customizedSdkUrl: string,
  sdkdir: string,
  buildList: string,
  target: string,
  customTarget: string,
  aqatestsRepo: string,
  openj9Repo: string,
  tkgRepo: string,
  vendorTestParams: string,
  aqasystemtestsRepo: string
): Promise<void> {
  await installDependencyAndSetup()
  setSpec()
  process.env.BUILD_LIST = buildList
  if (
    (jdksource === 'upstream' ||
      jdksource === 'github-hosted' ||
      jdksource === 'install-jdk') &&
    !('TEST_JDK_HOME' in process.env)
  ) {
    process.env.TEST_JDK_HOME = getTestJdkHome(version, jdksource)
  }

  if (!('TEST_JDK_HOME' in process.env)) {
    process.env.TEST_JDK_HOME = `${sdkdir}/openjdkbinary/j2sdk-image`
  }

  await getAqaTestsRepo(aqatestsRepo)
  await runGetSh(
    tkgRepo,
    openj9Repo,
    vendorTestParams,
    jdksource,
    customizedSdkUrl,
    sdkdir
  )

  resetJDKHomeFromProperties()

  //Get Dependencies, using /*zip*/dependents.zip to avoid loop every available files
  let dependents = await toolLib.downloadTool(
    'https://ci.adoptopenjdk.net/view/all/job/test.getDependency/lastSuccessfulBuild/artifact//*zip*/dependents.zip'
  )

  let sevenzexe = '7z'
  if (fs.existsSync('/usr/bin/yum')) {
    sevenzexe = '7za'
  }

  // Test.dependency only has one level of archive directory, none of actions toolkit support mv files by regex. Using 7zip discards the directory directly
  await taskLib.exec(sevenzexe, `e ${dependents} -o${process.env.GITHUB_WORKSPACE}/aqa-tests/TKG/lib`)

  if (buildList.includes('system')) {
    if (aqasystemtestsRepo && aqasystemtestsRepo.length !== 0) {
      getAqaSystemTestsRepo(aqasystemtestsRepo)
    }
    dependents = await toolLib.downloadTool(
      'https://ci.adoptopenjdk.net/view/all/job/systemtest.getDependency/lastSuccessfulBuild/artifact/*zip*/dependents.zip'
    )
    // System.dependency has different levels of archive structures archive/systemtest_prereqs/*.*
    // None of taskLib.mv, taskLib.cp and taskLib.exec can mv directories as expected (mv archive/ ./). Move subfolder systemtest_prereqs instead.
    const dependentPath = await toolLib.extractZip(
      dependents,
      `${process.env.GITHUB_WORKSPACE}/`
    )

    await taskLib.mv(
      `${dependentPath}/archive/systemtest_prereqs`,
      `${process.env.GITHUB_WORKSPACE}/aqa-tests`
    )
    await taskLib.rmRF(`${dependentPath}/archive`)
  }

  const options: ExecOptions = {}
  let myOutput = ''
  options.listeners = {
    stdout: (data: Buffer) => {
      myOutput += data.toString()
    }
  }
  process.chdir('TKG')
  try {
    await taskLib.exec('make', 'compile')
    if (target.includes('custom') && customTarget !== '') {
      const customOption = `${target
        .substr(1)
        .toUpperCase()}_TARGET=${customTarget}`
      await taskLib.exec('make', [`${target}`, `${customOption}`], options)
    } else {
      await taskLib.exec('make', [`${target}`], options)
    }
  } catch (error) {
    taskLib.error(error.message)
  }
  if (myOutput.includes('FAILED test targets') === true) {
    taskLib.error('There are failed tests')
  }
}

function resetJDKHomeFromProperties(): void {
  const pfile = `${process.env.GITHUB_WORKSPACE}/aqa-tests/job.properties`
  if (fs.existsSync(pfile)) {
    const lines = fs
      .readFileSync(pfile, 'utf-8')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter(Boolean)
    for (const l of lines) {
      const regexp = /TEST_JDK_HOME=(.*)/
      const match = regexp.exec(l)
      if (match && match[1]) {
        process.env.TEST_JDK_HOME = match[1]
        taskLib.debug(`Reset TEST_JDK_HOME to ${process.env.TEST_JDK_HOME}`)
      }
    }
  }
}

function getTestJdkHome(version: string, jdksource: string): string {
  // Try JAVA_HOME first and then fall back to GITHUB actions default location
  let javaHome = process.env[`JAVA_HOME_${version}_X64`] as string
  if (javaHome === undefined) {
    javaHome = process.env['JAVA_HOME'] as string
  }
  if (jdksource === 'install-jdk') {
    // work with AdoptOpenJDK/install-sdk
    if (`JDK_${version}` in process.env) {
      javaHome = process.env[`JDK_${version}`] as string
    } else {
      javaHome = process.env.JAVA_HOME as string
    }
  }
  // Remove spaces in Windows path and replace with a short name path, e.g. 'C:/Program Files/***' ->C:/Progra~1/***
  if (IS_WINDOWS && jdksource === 'github-hosted') {
    javaHome = javaHome.replace(/Program Files/g, 'Progra~1')
  }
  if (javaHome === undefined) {
    taskLib.error('JDK could not be found')
  }
  return javaHome
}

// This function is an alternative of extra install step in workflow or alternative install action. This could also be implemented as github action
async function installDependencyAndSetup(): Promise<void> {
  if (IS_WINDOWS) {
    const cygwinPath = 'C:\\cygwin64'
    try {
      if (!fs.existsSync(cygwinPath)) {
        taskLib.debug(`if the cygwin exist?`)
        await taskLib.mkdirP('C:\\cygwin64')
        await taskLib.mkdirP('C:\\cygwin_packages')
        await toolLib.downloadTool(
          'https://cygwin.com/setup-x86_64.exe',
          'C:\\temp\\cygwin.exe'
        )
        await taskLib.exec('C:\\temp\\cygwin.exe', `--packages wget,bsdtar,rsync,gnupg,git,autoconf,make,gcc-core,mingw64-x86_64-gcc-core,unzip,zip,cpio,curl,grep,perl --quiet-mode --download --local-install
        --delete-orphans --site  https://mirrors.kernel.org/sourceware/cygwin/
        --local-package-dir "C:\\cygwin_packages"
        --root "C:\\cygwin64"`)
        await taskLib.exec(
          'C:/cygwin64/bin/git', `config --system core.autocrlf false`
        )
        taskLib.prependPath(`C:\\cygwin64\\bin`)
      }
    } catch (error) {
      taskLib.warning(error.message)
    }
    const antContribFile = await toolLib.downloadTool(
      `https://sourceforge.net/projects/ant-contrib/files/ant-contrib/ant-contrib-1.0b2/ant-contrib-1.0b2-bin.zip/download`
    )
    await toolLib.extractZip(`${antContribFile}`, `${tempDirectory}`)
    await taskLib.cp(
      `${tempDirectory}/ant-contrib/lib/ant-contrib.jar`,
      `${process.env.ANT_HOME}\\lib`
    )
  } else if (process.platform === 'darwin') {
    await taskLib.exec('brew', 'install ant-contrib')
    await taskLib.exec('sudo', 'sysctl -w kern.sysv.shmall=655360')
    await taskLib.exec('sudo',  'sysctl -w kern.sysv.shmmax=125839605760')
  } else {
    if (fs.existsSync('/usr/bin/apt-get')) {
      // Debian Based
      await taskLib.exec('sudo', 'apt-get update')
      await taskLib.exec('sudo', 'apt-get install ant-contrib -y')
    } else if (fs.existsSync('/usr/bin/yum')) {
      // RPM Based
      await taskLib.exec('sudo', 'yum update -y')
      await taskLib.exec('sudo', 'yum install p7zip -y')
      const antContribFile = await toolLib.downloadTool(
        `https://sourceforge.net/projects/ant-contrib/files/ant-contrib/ant-contrib-1.0b2/ant-contrib-1.0b2-bin.zip/download`
      )
      await toolLib.extractZip(`${antContribFile}`, `${tempDirectory}`)
      await taskLib.cp(
        `${tempDirectory}/ant-contrib/lib/ant-contrib.jar`,
        `${process.env.ANT_HOME}\\lib`
      )
    } else if (fs.existsSync('/sbin/apk')) {
      // Alpine Based
      await taskLib.exec('apk', 'update')
      await taskLib.exec('apk', 'add p7zip')
      const antContribFile = await toolLib.downloadTool(
        `https://sourceforge.net/projects/ant-contrib/files/ant-contrib/ant-contrib-1.0b2/ant-contrib-1.0b2-bin.zip/download`
      )
      await toolLib.extractZip(`${antContribFile}`, `${tempDirectory}`)
      await taskLib.cp(
        `${tempDirectory}/ant-contrib/lib/ant-contrib.jar`,
        `${process.env.ANT_HOME}\\lib`
      )
    }

    if (fs.existsSync('/usr/bin/apt-get')) {
      //disable apport
      await taskLib.exec('sudo', 'service apport stop')
    }
  }
}

function setSpec(): void {
  if (IS_WINDOWS) {
    process.env['SPEC'] = 'win_x86-64_cmprssptrs'
  } else if (process.platform === 'darwin') {
    process.env['SPEC'] = 'osx_x86-64_cmprssptrs'
  } else {
    process.env['SPEC'] = 'linux_x86-64_cmprssptrs'
  }
}

async function getAqaTestsRepo(aqatestsRepo: string): Promise<void> {
  let repoBranch = ['adoptium/aqa-tests', 'master']
  if (aqatestsRepo.length !== 0) {
    repoBranch = parseRepoBranch(aqatestsRepo)
  }
  await taskLib.exec(
    'git', `clone --depth 1 -b ${repoBranch[1]} https://github.com/${repoBranch[0]}.git`
  )
  process.chdir('aqa-tests')
}

function getAqaSystemTestsRepo(aqasystemtestsRepo: string): void {
  const repoBranch = parseRepoBranch(aqasystemtestsRepo)
  process.env.ADOPTOPENJDK_SYSTEMTEST_REPO = repoBranch[0]
  process.env.ADOPTOPENJDK_SYSTEMTEST_BRANCH = repoBranch[1]
}

async function runGetSh(
  tkgRepo: string,
  openj9Repo: string,
  vendorTestParams: string,
  jdksource: string,
  customizedSdkUrl: string,
  sdkdir: string
): Promise<void> {
  let parameters = ''
  if (tkgRepo.length !== 0) {
    const repoBranch = parseRepoBranch(tkgRepo)
    parameters += `--tkg_branch ${repoBranch[1]} --tkg_repo https://github.com/${repoBranch[0]}.git`
  }
  if (openj9Repo.length !== 0) {
    const repoBranch = parseRepoBranch(openj9Repo)
    parameters += ` --openj9_branch ${repoBranch[1]} --openj9_repo https://github.com/${repoBranch[0]}.git`
  }
  if (jdksource.length !== 0) {
    parameters += ` --sdk_resource ${jdksource}`
  }
  if (customizedSdkUrl.length !== 0) {
    parameters += ` --customizedURL ${customizedSdkUrl}`
  }
  if (sdkdir.length !== 0) {
    parameters += ` --sdkdir ${sdkdir}`
  }
  if (IS_WINDOWS) {
    await taskLib.exec('bash', `./get.sh ${parameters} ${vendorTestParams}`)
  } else {
    await taskLib.exec('./get.sh', `${parameters} ${vendorTestParams}`)
  }
}

function parseRepoBranch(repoBranch: string): string[] {
  const tempRepo = repoBranch.replace(/\s/g, '')
  return tempRepo.split(':')
}