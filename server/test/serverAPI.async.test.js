import chai, {expect} from 'chai'
import helpers from '../src/helpers'
import {webhookHandler} from '../src/serverAPI'
// import integrationRest from '../src/integrationRest'

import auth from '../config/auth.config'
import {services} from '../config/const.config'
import {
  Entity,
} from '../src/types'

describe('projectExist', () => {
  const randomName = "temp-" + Math.random().toString(36).replace(/[^a-z0-9]+/g, '')

  it ('returns false for a non existing project', async () => {
    await Promise.all (services.map (async (service) => {
      const projExist: boolean = await webhookHandler.projectExist (randomName, service)
      expect (projExist).to.equal (false)
    }))
  })

  it ('returns true for a known test project', async () => {
    await Promise.all (services.map (async (service) => {
      const projExist: boolean = await webhookHandler.projectExist (auth[service].project, service)
      expect (projExist).to.equal (true)
    }))
  })
})

describe('throwIfAnyProjectNotExist', () => {
  it ('throws if any of services test project does not exist', async () => {
    await webhookHandler.throwIfAnyProjectNotExist ()
  })
})

// get issues since now
const testTimestamp = new Date ().getTime ()
const randomIssues = []

// create 2 issues on each service
describe('getProjectIssues', async () => {
  it ('returns only issues since given timestamp', async () => {
    await Promise.all (services.map (async (service) => {
      const issueA = webhookHandler.generateRandomIssue (service)
      const issueB = webhookHandler.generateRandomIssue (service)

      await webhookHandler.createIssue (issueA, service)
      await helpers.asyncTimeout (5000)
      const sinceTimestamp = new Date ().getTime ()
      await webhookHandler.createIssue (issueB, service)

      randomIssues.push (issueA, issueB)

      const issues = await webhookHandler.getProjectIssues (service, sinceTimestamp)
      expect (issues.length).to.equal (1)
    }))
  })
})

describe('initDoMirroring', async () => {
  it ('mirrors issues', async () => {
    // check that there are expected number of issues before mirroring
    await Promise.all (services.map (async (service) => {
      const issues = await webhookHandler.getProjectIssues (service, testTimestamp)
      expect (issues.length).to.equal (2)
    }))

    await webhookHandler.initDoMirroring ({testTimestamp})

    await Promise.all (services.map (async (service) => {
      const issues = await webhookHandler.getProjectIssues (service, testTimestamp)
      expect (issues.length).to.equal (4)
    }))
  })
})
