import chai, {expect} from 'chai'

import UsernameMapping, {UsernameInfo, KnownUsernameInfo} from '../src/UsernameMapping'

const testUsernameInfos = [
  {github: "githubUsername1", youtrack: "youtrackUsername1"},
  {github: "githubUsername2", youtrack: "youtrackUsername2"},
]

const testUsernameMapping = new UsernameMapping (testUsernameInfos)

describe ('UsernameMapping', () => {
  const knownInfo: KnownUsernameInfo = {
    username: testUsernameInfos[1]["github"],
    service: "github",
  }
  const knownInfoLowerCase: KnownUsernameInfo = {
    username: testUsernameInfos[1]["github"].toLowerCase (),
    service: "github",
  }

  it ('returns other username for provided KnownUsernameInfo', () => {
    const targetUsername = testUsernameMapping.getUsername (knownInfo, "youtrack")
    expect (targetUsername).to.equal (testUsernameInfos[1]["youtrack"])
  })

  it ('treats usernames as case isensitive', () => {
    const targetUsername = testUsernameMapping.getUsername (knownInfo, "youtrack")
    const targetUsernameLowerCase = testUsernameMapping.getUsername (knownInfoLowerCase, "youtrack")
    expect (targetUsername).to.equal (targetUsernameLowerCase)
  })

})
