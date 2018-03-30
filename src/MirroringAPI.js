import {
  Issue,
  IssueComment,
  Entity,
  IssueCommentInfo,
  IssueInfo,
  EntityInfo,
  Service,
} from './types'

import {
  mirrorMetaVarName,
} from '../config/const.config.js'

import UsernameMapping, {KnownUsernameInfo} from '../src/UsernameMapping.js'

const api = {}

api.getUniqueEntityId = (entity: EntityInfo): string =>
  [entity.service, entity.id, entity.issueId].join ("_")

api.getMeta = (entity: Entity): Object | void => {
  const varStart = `<!--${mirrorMetaVarName}=`
  const varEnd = "-->"
  const regexStr = `${varStart}(.*)${varEnd}`
  const regexRE = entity.body && entity.body.match(new RegExp(regexStr))
  if (regexRE && regexRE.length > 1)
    return JSON.parse(regexRE[1])
}

api.isOriginal = (entity: Entity): boolean => {
  const meta = api.getMeta (entity)
  return meta === undefined
}

api.getCommentParentInfo = (comment: IssueCommentInfo): IssueInfo => ({
  id: comment.issueId,
  service: comment.service,
})

api.getOriginalInfo = (entity: Entity): IssueInfo => {
  if (api.isOriginal (entity))
    throw "Expected a mirror"
  const mirrorMeta = api.getMeta (entity)

  return {
    id: mirrorMeta.id,
    service: mirrorMeta.service,
    issueId: mirrorMeta.issueId,
  }
}

api.generateMirrorSignature = (originalEntity: Entity, targetService: Service): string => api.getMetaAsEntityHtmlComment ({
  id: originalEntity.id,
  service: originalEntity.service,
  issueId: originalEntity.issueId,
}, targetService)

api.getMetaAsEntityHtmlComment = (meta: Object, targetService: Service): string => {
  const entityHtmlComment = api.wrapStringToHtmlComment (
      `${mirrorMetaVarName}=${JSON.stringify (meta)}`)

  switch (targetService) {
    case "youtrack": return `\n\n{html}${entityHtmlComment}{html}`
    case "github": return `\n\n${entityHtmlComment}`
  }
}

api.doListsContainSameElements = (listA: Array = [], listB: Array = []): boolean =>
  (listA.filter ((a) => listB.indexOf (a) === -1).length === 0 &&
  listB.filter ((b) => listA.indexOf (b) === -1).length === 0)

api.wrapStringToHtmlComment = (str: string): string => `<!--${str}-->`

api.generateRandomIssue = (service: string): Issue => ({
  id: Math.random ().toString (),
  title: Math.random ().toString (),
  body: Math.random ().toString (),
  service,
})

api.generateRandomComment = (service: string): IssueComment => ({
  id: Math.random ().toString (),
  body: Math.random ().toString (),
  issueId: Math.random ().toString (),
  service,
})

api.throwIfValueNotAllowed = (value, allowed: Array): void => {
  if (allowed.indexOf (value) === -1)
    throw `Parameter \`${value}\` has to be: ${allowed.join (" | ")}`
}

api.formatTimestampAsDuration = (ts: number): string =>
  [ts / 3600, ts % 3600 / 60, ts % 60].map((p) => Math.floor(p)).join (":")

api.getIndexAfterLast = (str: string, inStr: string): number => {
  const l = inStr.lastIndexOf (str)
  return l === -1 ? -1 : l + str.length
}

api.getIssueIdFromRequestBody = (sourceService: string, reqBody: Object): string | void => {
  if (sourceService === "youtrack") return reqBody.issueId.toString ()
  if (sourceService === "github") return reqBody.issue && reqBody.issue.number.toString ()
}

api.getTitlePrefix = (issue: Issue, targetService): string => {
  switch (targetService) {
    case "github": return `[${issue.id}] `
    case "youtrack": return `(#${issue.id}) `
  }
}

api.removeNonLettersFromEnd = (str: string): string => {
  while (str !== "" && str[str.length - 1].match(/[a-z0-9]/i) === null)
    str = str.substring (0, str.length - 1)
  return str || ""
}

api.convertMentions = (body: string, sourceService: string, targetService: string,
  usernameMapping: UsernameMapping): string => {
  const replacedBody = body.replace (/\B@[a-z0-9.]+/ig, ((m) => {
    // remove @ symbol
    m = m.substring (1)

    const username = m && api.removeNonLettersFromEnd (m)

    if (username) {
      const knownUsernameInfo: KnownUsernameInfo = {
        username,
        service: sourceService,
      }
      const counterpartUsername = usernameMapping.getUsername (knownUsernameInfo, targetService)

      if (counterpartUsername)
        return `@${counterpartUsername}`
    }

    // else break mention
    return `@'${m}`
  }))

  return replacedBody
}

api.asyncTimeout = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

api.getCounterpartService = (service: Service) => {
  switch (service) {
    case "youtrack": return "github"
    case "github": return "youtrack"
  }
}

export default api
export const getUniqueEntityId = api.getUniqueEntityId
export const getMeta = api.getMeta
export const isOriginal = api.isOriginal
export const getCommentParentInfo = api.getCommentParentInfo
export const getOriginalInfo = api.getOriginalInfo
export const generateMirrorSignature = api.generateMirrorSignature
export const getMetaAsEntityHtmlComment = api.getMetaAsEntityHtmlComment
export const wrapStringToHtmlComment = api.wrapStringToHtmlComment
export const generateRandomIssue = api.generateRandomIssue
export const generateRandomComment = api.generateRandomComment
export const throwIfValueNotAllowed = api.throwIfValueNotAllowed
export const formatTimestampAsDuration = api.formatTimestampAsDuration
export const getIndexAfterLast = api.getIndexAfterLast
export const getIssueIdFromRequestBody = api.getIssueIdFromRequestBody
export const doListsContainSameElements = api.doListsContainSameElements
export const getTitlePrefix = api.getTitlePrefix
export const removeNonLettersFromEnd = api.removeNonLettersFromEnd
export const convertMentions = api.convertMentions
export const asyncTimeout = api.asyncTimeout
export const getCounterpartService = api.getCounterpartService
