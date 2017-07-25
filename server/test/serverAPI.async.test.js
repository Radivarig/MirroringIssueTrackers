import chai, {expect} from 'chai'

import {
  getCounterpartService,
  isOriginal,
  getMeta,
  getOriginalInfo,
} from '../src/MirroringAPI.js'

import serverAPI from '../src/serverAPI'

import MirroringEngine from '../src/MirroringEngine'
const mirroringEngine = new MirroringEngine ()

import auth from '../config/auth.config'
import {services} from '../config/const.config'
import {
  EntityService,
  Issue,
} from '../src/types'

describe('projectExist', () => {
  const randomName = "temp-" + Math.random().toString(36).replace(/[^a-z0-9]+/g, '')

  it ('returns false for a non existing project', async () => {
    await Promise.all (services.map (async (service) => {
      const projExist: boolean = await serverAPI.projectExist (randomName, service)
      expect (projExist).to.equal (false)
    }))
  })

  it ('returns true for a known test project', async () => {
    await Promise.all (services.map (async (service) => {
      const projExist: boolean = await serverAPI.projectExist (auth[service].project, service)
      expect (projExist).to.equal (true)
    }))
  })
})

describe('throwIfAnyProjectNotExist', () => {
  it ('throws if any of services test project does not exist', async () => {
    await serverAPI.throwIfAnyProjectNotExist ()
  })
})

describe('createIssue, createComment', async () => {
  it ('creates an issue/comment and returns its new info', async () => {
    await Promise.all (services.map (async (service) => {
      const issue1 = serverAPI.generateRandomIssue (service)
      const newIssueService1: EntityService = await serverAPI.createIssue (issue1, service)
      const newIssue1: Issue = await serverAPI.getIssue (newIssueService1)

      expect (issue1.body).to.equal (newIssue1.body)
      expect (issue1.title).to.equal (newIssue1.title)

      const comment1 = await serverAPI.generateRandomComment (service)
      const newCommentService1: EntityService = await serverAPI.createComment (comment1, newIssueService1)
      const newComment1 = await serverAPI.getComment (newCommentService1)

      expect (comment1.body).to.equal (newComment1.body)
      expect (comment1.title).to.equal (newComment1.title)
    }))
  })
})

describe('getTimestampOfLastIssue', async () => {
  it ('returns timestamp of last created issue', async () => {
    await Promise.all (services.map (async (service) => {
      const issue1 = serverAPI.generateRandomIssue (service)
      const newIssueService1: EntityService = await serverAPI.createIssue (issue1, service)
      const newIssue1: Issue = await serverAPI.getIssue (newIssueService1)
      const lastTs = await serverAPI.getTimestampOfLastIssue (service)
      expect (newIssue1.createdAt).to.equal (lastTs)
    }))
  })
})

describe('doMirroring', async () => {
  it ('creates mirrors of issues', async () => {
    await Promise.all (services.map (async (service) => {
      mirroringEngine.sinceTimestamps[service] = await serverAPI.getTimestampOfLastIssue (service)

      const issue1 = serverAPI.generateRandomIssue (service)
      const newIssueService1: EntityService = await serverAPI.createIssue (issue1, service)
      const newIssue1: Issue = await serverAPI.getIssue (newIssueService1)

      const issues: Array<Issue> = await serverAPI.getProjectIssues (service, mirroringEngine.sinceTimestamps[service])
      expect (issues.length).to.equal (1)
    }))
    await mirroringEngine.doMirroring ()

    await Promise.all (services.map (async (service) => {
      const issues = await serverAPI.getProjectIssues (service, mirroringEngine.sinceTimestamps[service])

      // expect originals (1) and mirrors from other service (1)
      expect (issues.length).to.equal (2)

      // test existence of mirrors
      const mirrorIssues = issues.filter ((issue) => !isOriginal (issue))
      expect (mirrorIssues.length).to.equal (1)
    }))
  })

  it ('creates comments', async () => {
    await Promise.all (services.map (async (service) => {
      const commentA = serverAPI.generateRandomComment (service)
      const commentB = serverAPI.generateRandomComment (service)

      const issues = await serverAPI.getProjectIssues (service, mirroringEngine.sinceTimestamps[service])

      // comment on first issue
      const parentIssue = issues[0]
      await serverAPI.createComment (commentA, parentIssue)
      await serverAPI.createComment (commentB, parentIssue)

      const issueComments = await serverAPI.getComments (parentIssue)

      // test comment creation
      expect (issueComments.length).to.equal (2)
      // test comment equality
      expect (issueComments[0].body).to.equal (commentA.body)
      expect (issueComments[1].body).to.equal (commentB.body)

      // add issueId
      commentA.issueId = parentIssue.id
      commentB.issueId = parentIssue.id
    }))
  })

  it ('mirrors comments', async () => {
    await mirroringEngine.doMirroring ()

    const githubIssues = await serverAPI.getProjectIssues ("github", mirroringEngine.sinceTimestamps["github"])
    const youtrackIssues = await serverAPI.getProjectIssues ("youtrack", mirroringEngine.sinceTimestamps["youtrack"])

    expect (githubIssues.length).to.equal (youtrackIssues.length)

    // todo: do for mirrors of youtrack
    for (const githubIssue of githubIssues) {
      if (!isOriginal (githubIssue)) {
        const origInfo = getOriginalInfo (githubIssue)
        const origsOnYt = youtrackIssues.filter (yti => {
          if (!isOriginal (yti))
            return
          return (origInfo.id === yti.id &&
            origInfo.service === yti.service)
        })
        expect (origsOnYt.length).to.equal (1)
        expect (serverAPI.isOriginalEqualToMirror (githubIssue, origsOnYt[0]))

        // githubIssues is now a mirror
        const githubComments = await serverAPI.getComments ({service: "github", id: githubIssue.id})
        // get original from mirror meta.id
        const originalId = getMeta (githubIssue).id
        const youtrackComments = await serverAPI.getComments ({service: "youtrack", id: originalId})

        expect (githubComments.length).to.equal (youtrackComments.length)

        for (const ghc of githubComments) {
          if (isOriginal (ghc)) {
            const mirrorsOnYt = youtrackComments.filter (ytc => {
              if (isOriginal (ytc))
                return
              const origInfo = getOriginalInfo (ytc)
              return (origInfo.id === ghc.id &&
                origInfo.service === ghc.service &&
                origInfo.issueId === ghc.issueId)
            })
            expect (mirrorsOnYt.length).to.equal (1)
            expect (serverAPI.isOriginalEqualToMirrorComment (ghc, mirrorsOnYt[0]))
          }
          else {
            const origInfo = getOriginalInfo (ghc)
            const origsOnYt = youtrackComments.filter (ytc => {
              if (!isOriginal (ytc))
                return
              return (origInfo.id === ytc.id &&
                origInfo.service === ytc.service &&
                origInfo.issueId === ytc.issueId)
            })
            expect (origsOnYt.length).to.equal (1)
            expect (serverAPI.isOriginalEqualToMirrorComment (origsOnYt[0], ghc))
          }
        }
      }
    }
  })

})
