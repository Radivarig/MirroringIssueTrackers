import {expect} from 'chai'

import {
  getUniqueEntityId,
  getMeta,
  isOriginal,
  getCommentParentInfo,
  getOriginalInfo,
  generateMirrorSignature,
  getMetaAsEntityHtmlComment,
  wrapStringToHtmlComment,
  generateRandomIssue,
  generateRandomComment,
  removeNonLettersFromEnd,
  getIndexAfterLast,
  getTitlePrefix,
  convertMentions,
} from '../src/MirroringAPI.js'

import {
  Issue,
  EntityInfo,
} from '../src/types'

import UsernameMapping, {KnownUsernameInfo} from '../src/UsernameMapping.js'

describe('MirroringAPI', () => {
  describe ('getUniqueEntityId', () => {
    it ('should return <service>_<id>_<issueId>', () => {
      const issue1 = {id: "i1", service: "s1"}
      const comment1OfIssue1 = {id: "c1", service: "s1", issueId: "i1"}
      const uniqueIssueId = getUniqueEntityId (issue1)
      expect (uniqueIssueId).to.equal ("s1_i1_")
      const uniqueCommentId = getUniqueEntityId (comment1OfIssue1)
      expect (uniqueCommentId).to.equal ("s1_c1_i1")
    })
  })

  describe ('getMeta', () => {
    it ('should return mirror meta if any', () => {
      const comment1 = generateRandomComment ("github")
      const signature = generateMirrorSignature (comment1, "youtrack")
      const commentMirror1 = {...comment1, body: signature}

      expect (getMeta (comment1)).to.equal (undefined)
      expect (getMeta (commentMirror1)).to.contain ({
        id: comment1.id,
        service: comment1.service,
      })
    })
  })

  describe ('isOriginal', () => {
    it ('returns boolean for entity has mirror signature', () => {
      const issue: Issue = {id: "i1", service: "s1", title: "", body: "body"}
      const issueMirror: Issue = {id: "im1", service: "s2", title: "", body: "body" + generateMirrorSignature (issue, "github")}

      expect (isOriginal (issue)).to.equal (true)
      expect (isOriginal (issueMirror)).to.equal (false)
    })
  })

  describe ('getCommentParentInfo', () => {
    it ('should return issue info of its parent', () => {
      const comment1 = {id: "c1", service: "s1", issueId: "i1"}
      const commentParent1 = getCommentParentInfo (comment1)
      expect (commentParent1.service).to.equal (comment1.service)
      expect (commentParent1.id).to.equal (comment1.issueId)
    })
  })

  describe ('getOriginalInfo', () => {
    it ('should return original issue info', () => {
      const issue = generateRandomIssue ("youtrack")
      const signature = generateMirrorSignature (issue, "github")
      issue.body += signature
      expect (getOriginalInfo (issue)).to.contain ({id: issue.id, service: issue.service})
    })
  })

  describe ('generateMirrorSignature', () => {
    it ('returns entity info as meta wrapped in html comment', () => {
      const comment1 = generateRandomComment ("github")
      const signature = generateMirrorSignature (comment1, "youtrack")
      const commentMirror1 = {...comment1, body: signature}
      expect (getMeta (commentMirror1)).to.contain ({
        id: comment1.id,
        service: comment1.service,
      })
    })
  })

  describe ('getMetaAsEntityHtmlComment', () => {
    const meta = {a: 1, b: 2}
    const htmlCommentGithub = getMetaAsEntityHtmlComment (meta, "github")
    const htmlCommentYoutrack = getMetaAsEntityHtmlComment (meta, "youtrack")

    it ('should start with two newlines', () => {
      expect (htmlCommentGithub.indexOf ("\n\n")).to.equal (0)
      expect (htmlCommentYoutrack.indexOf ("\n\n")).to.equal (0)
    })

    it ('(youtrack) should be wrapped in {html}', () => {
      expect (htmlCommentYoutrack.indexOf (`\n\n{html}`)).to.equal (0)
      const lastInd = htmlCommentYoutrack.length - "{html}".length
      expect (htmlCommentYoutrack.lastIndexOf (`{html}`)).to.equal (lastInd)
    })
    
  })

  describe('removeNonLettersFromEnd', () => {
    const username = "user.name"
    const endOfWord = "!#$%&/(..."
    const usernameAndEndOfWord = username + endOfWord

    it ('returns empty string if no letters are in provided string', () => {
      expect (removeNonLettersFromEnd (endOfWord)).to.equal ("")
    })

    it ('returns first part of the string without the non letter characters', () => {
      expect (removeNonLettersFromEnd (usernameAndEndOfWord)).to.equal (username)
    })
  })

  describe ('wrapStringToHtmlComment', () => {
    it ('adds <!-- before and --> after the string', () => {
      const str = "some str"
      const wrappedStr = wrapStringToHtmlComment (str)
      expect (wrappedStr).to.equal (`<!--${str}-->`)
    })
  })

  describe ('getTitlePrefix', () => {
    it ('(github) wraps issue id in [..]', () => {
      const issue = generateRandomIssue ("github")
      expect (getTitlePrefix (issue, "youtrack")).to.equal (`(#${issue.id}) `)
    })
    it ('(youtrack) wraps issue id in (#..)', () => {
      const issue = generateRandomIssue ("youtrack")
      expect (getTitlePrefix (issue, "github")).to.equal (`[${issue.id}] `)
    })
  })


  describe ('getIndexAfterLast', () => {
    it ('returns lastIndexOf str + str length', () => {
      const str = "some some some str"
      const afterLastInd = getIndexAfterLast ("some", str)
      expect (afterLastInd).to.equal (14)
    })

    it ('returns -1 if string not found', () => {
      const str = "some some some str"
      const afterLastInd = getIndexAfterLast (str, "some")
      expect (afterLastInd).to.equal (-1)
    })
  })

  describe('convertMentions', () => {
    const charAfterMonkeyIfNoMatch = "'"

    const usernameInfos = [{github: "githubUsername1", youtrack: "youtrackUsername1"}]
    const usernameMapping = new UsernameMapping (usernameInfos)

    it ('replaces all usernames with their couterparts if found', () => {

      // use github username, expect it be replaced with youtrack username
      const originalBody = "@start @" +usernameInfos[0].github +" @middle @end\n@second_line"
      const convertedBody: string = convertMentions (originalBody, "github", "youtrack", usernameMapping)

      const convertedBodyMentions = convertedBody.match (/\B@[a-z0-9.]+/ig)
      expect (convertedBodyMentions).to.not.equal (null)

      convertedBodyMentions.map ((m) => {
        // remove @
        m = m.substring (1)
        const username = m && removeNonLettersFromEnd (m)

        // if mention not broken, expect the username to be found and replaced
        const knownInfo: KnownUsernameInfo = {username, service: "youtrack"}
        const originalUsername = usernameMapping.getUsername (knownInfo, "github")
        expect (originalUsername).to.not.equal (undefined)
      })
    })

    it ('breaks all non matched mention formats', () => {
      const originalBody = "@start @middle @end\n@second_line"
      const convertedBody = convertMentions (originalBody, "github", "youtrack", usernameMapping)

      // expect all @ symbols be followed by charAfterMonkeyIfNoMatch
      const regEx = new RegExp ("\\B@[^" +charAfterMonkeyIfNoMatch +"]+", "ig")
      const matches = convertedBody.match (regEx)
      expect (matches).to.equal (null)
    })
  })

})
