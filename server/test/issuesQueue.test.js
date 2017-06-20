import chai, {expect} from 'chai'
import helpers from '../src/helpers'
import {webhookHandler} from '../src/serverAPI'

import {
  EntityService,
} from '../src/types'

describe('operationOnQueue', async () => {
  it ('calls a callback', async () => {
    let cbCalled = false
    const cb = () => {cbCalled = true}
    await webhookHandler.operationOnQueue (cb)
    expect (cbCalled).to.equal (true)
  })

  it ('locks the queue until callback is done', async () => {
    expect (webhookHandler.getIsIssuesQueueLocked ()).to.equal (false)
    const awaitFor = 10
    const cb = async () => {
      await helpers.asyncTimeout (awaitFor)
    }
    // intentionally not awaited
    webhookHandler.operationOnQueue (cb)
    await helpers.asyncTimeout (0)

    expect (webhookHandler.getIsIssuesQueueLocked ()).to.equal (true)
    await helpers.asyncTimeout (awaitFor)
    expect (webhookHandler.getIsIssuesQueueLocked ()).to.equal (false)
  })

  it ('awaits until queue is unlocked', async () => {
    let mutatedVar = 0
    const cb1 = async () => {
      mutatedVar = 1
      await helpers.asyncTimeout (10)
    }
    let cb2Called = false

    const cb2 = async () => {
      expect (mutatedVar).to.equal (1)
      cb2Called = true
    }

    // intentionally not awaited
    webhookHandler.operationOnQueue (cb1)
    await helpers.asyncTimeout (0)

    await webhookHandler.operationOnQueue (cb2)
    expect (cb2Called).to.equal (true)
  })
})

describe('addIssueToQueue', async () => {
  it ('keeps a single instance of issue and prepends it to queue', async () => {
    expect (webhookHandler.getIssuesQueue ().length).to.equal (0)
    await webhookHandler.addIssueToQueue ({id: "1", service: "a"})
    await webhookHandler.addIssueToQueue ({id: "1", service: "a"})
    await webhookHandler.addIssueToQueue ({id: "2", service: "a"})

    expect (webhookHandler.getIssuesQueue ().length).to.equal (2)
    expect (webhookHandler.getIssuesQueue ()[0].id === "2")
  })
})

describe('removeIssueFromQueue', async () => {
  it ('removes issue from queue', async () => {
    expect (webhookHandler.getIssuesQueue ().length).to.equal (2)
    await webhookHandler.removeIssueFromQueue ({id: "1", service: "a"})
    expect (webhookHandler.getIssuesQueue ().length).to.equal (1)
    expect (webhookHandler.getIssuesQueue ()[0].id).to.equal ("2")
    await webhookHandler.removeIssueFromQueue ({id: "2", service: "a"})
    expect (webhookHandler.getIssuesQueue ().length).to.equal (0)
  })
})

