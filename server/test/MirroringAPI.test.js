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
  generateRandomComment,
} from '../src/MirroringAPI.js'

import {
  Issue,
  EntityInfo,
} from '../src/types'

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

  describe ('wrapStringToHtmlComment', () => {
    it ('adds <!-- before and --> after the string', () => {
      const str = "some str"
      const wrappedStr = wrapStringToHtmlComment (str)
      expect (wrappedStr).to.equal (`<!--${str}-->`)
    })
  })

})
