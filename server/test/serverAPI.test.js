import chai, {expect} from 'chai'
import {asyncTimeout} from '../src/helpers'
import {webhookHandler} from '../src/serverAPI'
import integrationRest from '../src/integrationRest'
import {
  Issue,
} from '../src/types'

const originalYoutrackIssue: Issue = {
  id: "TEST-1",
  title: "test title",
  body: "test body",
  service: "youtrack",
}

const mirrorOfYoutrackIssue: Issue =
  webhookHandler.getPreparedMirrorIssueForUpdate (originalYoutrackIssue, "github")

describe('getIsOriginal', () => {

  it ('returns true if entity body does not contain meta html comment', () => {
    const isOriginal = webhookHandler.getIsOriginal (originalYoutrackIssue)
    expect (isOriginal).to.equal (true)
  })

  it ('returns false if entity body does contain meta html comment', () => {
    const isOriginal = webhookHandler.getIsOriginal (mirrorOfYoutrackIssue)
    expect (isOriginal).to.equal (false)
  })
})

describe('convertMentions', () => {

  it ('breaks all mention formats', () => {
    const allMonkeysFollowedByApopstrophe = false
    const originalBody = "@start @middle @end\n@second_line"
    const convertedBody = webhookHandler.convertMentions (originalBody, "")

    const matches = convertedBody.match (/\B@[^']+/ig)
    expect (matches).length.to.equal (null)
  })

})
