import {
  Issue,
  IssueComment,
  Entity,
  IssueCommentInfo,
  IssueInfo,
  EntityInfo,
} from './types'

import {
  mirrorMetaVarName,
} from '../config/const.config'

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

api.generateMirrorSignature = (originalEntity: Entity, targetService): string => api.getMetaAsEntityHtmlComment ({
  id: originalEntity.id,
  service: originalEntity.service,
  issueId: originalEntity.issueId,
}, targetService)

api.getMetaAsEntityHtmlComment = (meta: Object, targetService: string): string => {
  const entityHtmlComment = api.wrapStringToHtmlComment (
      `${mirrorMetaVarName}=${JSON.stringify (meta)}`)

  switch (targetService) {
    case "youtrack": return `\n\n{html}${entityHtmlComment}{html}`
    case "github": return `\n\n${entityHtmlComment}`
  }
},

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

api.getIndexAfterLast = (str: string, inStr: string): number =>
  inStr.lastIndexOf (str) + str.length

api.getIssueIdFromRequestBody = (sourceService: string, reqBody: Object): string | void => {
  if (sourceService === "youtrack") return reqBody.issueId.toString ()
  if (sourceService === "github") return reqBody.issue && reqBody.issue.number.toString ()
}

export default api
export const getUniqueEntityId = api.getUniqueEntityId
export const getMeta = api.getMeta
export const isOriginal = api.isOriginal
export const getCommentParentInfo = api.getCommentParentInfo
export const generateMirrorSignature = api.generateMirrorSignature
export const getMetaAsEntityHtmlComment = api.getMetaAsEntityHtmlComment
export const wrapStringToHtmlComment = api.wrapStringToHtmlComment
export const generateRandomIssue = api.generateRandomIssue
export const generateRandomComment = api.generateRandomComment
export const throwIfValueNotAllowed = api.throwIfValueNotAllowed
export const formatTimestampAsDuration = api.formatTimestampAsDuration
export const getIndexAfterLast = api.getIndexAfterLast
export const getIssueIdFromRequestBody = api.getIssueIdFromRequestBody
