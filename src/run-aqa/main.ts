import * as taskLib from "azure-pipelines-task-lib/task";
import * as runaqa from './runaqa'

async function run(): Promise<void> {
    try {
      const jdksource = taskLib.getInput('jdksource', false)
      const customizedSdkUrl = taskLib.getInput('customizedSdkUrl', false)
      let sdkdir = taskLib.getInput('sdkdir', false)
      const version = taskLib.getInput('version', false)
      const buildList = taskLib.getInput('build_list', false)
      const target = taskLib.getInput('target', false)
      const customTarget = taskLib.getInput('custom_target', false)
      const aqatestsRepo = taskLib.getInput('aqa-testsRepo', false)
      const aqasystemtestsRepo = taskLib.getInput('aqa-systemtestsRepo', false)
      const openj9Repo = taskLib.getInput('openj9_repo', false)
      const tkgRepo = taskLib.getInput('tkg_Repo', false)
      const vendorTestRepos = taskLib.getInput('vendor_testRepos', false)
      const vendorTestBranches = taskLib.getInput('vendor_testBranches', false)
      const vendorTestDirs = taskLib.getInput('vendor_testDirs', false)
      const vendorTestShas = taskLib.getInput('vendor_testShas', false)
  
      let vendorTestParams = ''
      //  let arch = taskLib.getInput("architecture", { required: false })
      if (
        jdksource !== 'upstream' &&
        jdksource !== 'github-hosted' &&
        jdksource !== 'install-jdk' &&
        jdksource !== 'nightly' &&
        jdksource !== 'customized'
      ) {
        taskLib.error(
          `jdksource should be one of [upstream, github-hosted, install-jdk, nightly, customized]. Found: ${jdksource}`
        )
      }
  
      if (
        buildList !== 'openjdk' &&
        !buildList.startsWith('external') &&
        !buildList.startsWith('functional') &&
        !buildList.startsWith('perf') &&
        !buildList.startsWith('system')
      ) {
        taskLib.setResult(taskLib.TaskResult.Failed, `buildList should be one of or sub dir of [openjdk, external, functional, system, perf]. Found: ${buildList}`);
      }
      if (
        (jdksource === 'github-hosted' || jdksource === 'install-jdk') &&
        version.length === 0
      ) {
        taskLib.setResult(taskLib.TaskResult.Failed, 'Please provide jdkversion if jdksource is github-hosted installed or AdoptOpenJKD/install-jdk installed.');
      }
      if (vendorTestRepos !== '') {
        vendorTestParams = `--vendor_repos ${vendorTestRepos}`
      }
      if (vendorTestBranches !== '') {
        vendorTestParams += ` --vendor_branches ${vendorTestBranches}`
      }
      if (vendorTestDirs !== '') {
        vendorTestParams += ` --vendor_dirs ${vendorTestDirs}`
      }
      if (vendorTestShas !== '') {
        vendorTestParams += ` --vendor_shas ${vendorTestShas}`
      }
      if (sdkdir === '') {
        sdkdir = process.cwd()
      }
      await runaqa.runaqaTest(
        version,
        jdksource,
        customizedSdkUrl,
        sdkdir,
        buildList,
        target,
        customTarget,
        aqatestsRepo,
        openj9Repo,
        tkgRepo,
        vendorTestParams,
        aqasystemtestsRepo
      )
    } catch (error) {
      taskLib.setResult(taskLib.TaskResult.Failed, error.message);
    }
  }
  
  run()
