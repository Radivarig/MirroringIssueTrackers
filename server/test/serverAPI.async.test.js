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

// store created
const testEntities = {}
services.map (
  service => {
    testEntities[service] = {
      issues: [],
      comments: [],
    }
  }
)

describe('getProjectIssues', async () => {
  it ('returns only issues since given timestamp', async () => {
    await Promise.all (services.map (async (service) => {
      const issueA = webhookHandler.generateRandomIssue (service)
      const issueB = webhookHandler.generateRandomIssue (service)

      // create one issue before timestamp
      await webhookHandler.createIssue (issueA, service)

      const timestampMismatch = 10000
      await helpers.asyncTimeout (timestampMismatch)

      const sinceTimestamp = new Date ().getTime ()
      // create another after the timestamp
      await webhookHandler.createIssue (issueB, service)

      const issues = await webhookHandler.getProjectIssues (service, sinceTimestamp)

      expect (issues.length).to.equal (1)

      testEntities[service].issues.push (issueA)
      testEntities[service].issues.push (issueB)
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

    // do mirroring
    await webhookHandler.initDoMirroring ({testTimestamp})

    await Promise.all (services.map (async (service) => {
      const issues = await webhookHandler.getProjectIssues (service, testTimestamp)

      // expect originals (2) and mirrors from other service (2)
      expect (issues.length).to.equal (4)

      // test existence of mirrors
      const mirrorIssues = issues.filter ((issue) => !webhookHandler.getIsOriginal (issue))
      expect (mirrorIssues.length).to.equal (2)
    }))
  })

  it ('creates comments', async () => {
    await Promise.all (services.map (async (service) => {
      const commentA = await webhookHandler.generateRandomComment (service)
      const commentB = await webhookHandler.generateRandomComment (service)

      const issues = await webhookHandler.getProjectIssues (service, testTimestamp)

      // comment on first issue
      const parentIssueId = issues[0].id
      await webhookHandler.createComment (commentA, service, parentIssueId)
      await webhookHandler.createComment (commentB, service, parentIssueId)

      const issueComments = await webhookHandler.getComments (service, parentIssueId)

      // test comment creation
      expect (issueComments.length).to.equal (2)
      // test comment equality
      expect (issueComments[0].body).to.equal (commentA.body)
      expect (issueComments[1].body).to.equal (commentB.body)

      // add issueId
      commentA.issueId = parentIssueId
      commentB.issueId = parentIssueId

      // store test comments
      testEntities[service].comments.push (commentA)
      testEntities[service].comments.push (commentB)
    }))
  })

  it ('mirrors comments', async () => {
    await webhookHandler.initDoMirroring ({testTimestamp})

    const githubIssues = await webhookHandler.getProjectIssues ("github", testTimestamp)
    const youtrackIssues = await webhookHandler.getProjectIssues ("youtrack", testTimestamp)

    expect (githubIssues.length).to.equal (youtrackIssues.length)

    for (let i = 0; i < githubIssues.length; ++i) {
      const githubIssue = githubIssues [i]
      const youtrackIssue = youtrackIssues [i]

      // expect one to be original and other a mirror
      if (webhookHandler.getIsOriginal (githubIssue))
        expect (webhookHandler.getIsOriginal (youtrackIssue)).to.equal (false)
      else
        expect (webhookHandler.getIsOriginal (youtrackIssue)).to.equal (true)

      expect (webhookHandler.getIsOriginalEqualToMirror (githubIssue, youtrackIssue))

     // check only mirrors as they have issueId of original to match
      if (webhookHandler.getIsOriginal (githubIssue))
        return

      // githubIssues is now a mirror
      const githubComments = await webhookHandler.getComments ("github", githubIssue.id)
      // get original from mirror meta.id
      const originalId = webhookHandler.getMeta (githubIssue).id
      const youtrackComments = await webhookHandler.getComments ("youtrack", originalId)

      expect (githubComments.length).to.equal (youtrackComments.length)

      for (let j = 0; j < githubComments.length; ++j) {
        const githubComment = githubComments [j]
        const youtrackComment = youtrackComments [j]

        // expect one to be original and other a mirror
        if (webhookHandler.getIsOriginal (githubComment))
          expect (webhookHandler.getIsOriginal (youtrackComment)).to.equal (false)
        else
          expect (webhookHandler.getIsOriginal (youtrackComment)).to.equal (true)

        expect (webhookHandler.getIsOriginalEqualToMirror (githubComment, youtrackComment))
      }
    }
  })

})
