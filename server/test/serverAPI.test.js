import chai, {expect} from 'chai'
import {asyncTimeout} from '../src/helpers'
import {webhookHandler} from '../src/serverAPI'
import integrationRest from '../src/integrationRest'


const originalYoutrackIssue: Issue = {
  id: "TEST-1",
  title: "test title",
  body: "test body",
  service: "youtrack",
}

const mirrorOfYoutrackIssue: Issue =
  webhookHandler.getPreparedMirrorIssueForUpdate (originalYoutrackIssue, "github")

describe('getIsOriginal', () => {

  it ('returns true if entity body does not contain meta html comment', async () => {
    const isOriginal = webhookHandler.getIsOriginal (originalYoutrackIssue)
    expect (isOriginal).to.equal (true)
  })

  it ('returns false if entity body does contain meta html comment', async () => {
    const isOriginal = webhookHandler.getIsOriginal (mirrorOfYoutrackIssue)
    expect (isOriginal).to.equal (false)
  })
})
