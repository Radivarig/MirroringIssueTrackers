import chai, {expect} from 'chai'
import {asyncTimeout} from '../src/helpers'
import {webhookHandler} from '../src/serverAPI'
import integrationRest from '../src/integrationRest'
import UsernameMapping, {KnownUsernameInfo} from '../src/UsernameMapping' 

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

describe('removeNonLettersFromEnd', () => {
  const username = "user.name"
  const endOfWord = "!#$%&/(..."
  const usernameAndEndOfWord = username + endOfWord

  it ('returns empty string if no letters are in provided string', () => {
    expect (webhookHandler.removeNonLettersFromEnd (endOfWord)).to.equal ("")
  })

  it ('returns first part of the string without the non letter characters', () => {
    expect (webhookHandler.removeNonLettersFromEnd (usernameAndEndOfWord)).to.equal (username)
  })
})

describe('convertMentions', () => {
  const charAfterMonkeyIfNoMatch = "("

  const usernameInfos = [{github: "githubUsername1", youtrack: "youtrackUsername1"}]
  const usernameMapping = new UsernameMapping (usernameInfos)

  it ('replaces all usernames with their couterparts if found', () => {

    // use github username, expect it be replaced with youtrack username
    const originalBody = "@start @" +usernameInfos[0].github +" @middle @end\n@second_line"
    const convertedBody: string = webhookHandler.convertMentionsRaw (originalBody, "github", "youtrack", usernameMapping)

    const convertedBodyMentions = convertedBody.match (/\B@[a-z0-9.]+/ig)
    expect (convertedBodyMentions).to.not.equal (null)

    convertedBodyMentions.map ((m) => {
      // remove @
      m = m.substring (1)
      const username = m && webhookHandler.removeNonLettersFromEnd (m)

      // if mention not broken, expect the username to be found and replaced
      const knownInfo: KnownUsernameInfo = {username, service: "youtrack"}
      const originalUsername = usernameMapping.getUsername (knownInfo, "github")
      expect (originalUsername).to.not.equal (undefined)
    })

  })

  it ('breaks all non matched mention formats', () => {
    const originalBody = "@start @middle @end\n@second_line"
    const convertedBody = webhookHandler.convertMentionsRaw (originalBody, "github", "youtrack", usernameMapping)

    // expect all @ symbols be followed by charAfterMonkeyIfNoMatch
    const regEx = new RegExp ("\\B@[^" +charAfterMonkeyIfNoMatch +"]+", "ig")
    const matches = convertedBody.match (regEx)
    expect (matches).to.equal (null)
  })

})
