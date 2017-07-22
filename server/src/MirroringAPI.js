import {
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

api.getCommentParentInfo = (comment: IssueCommentInfo): IssueInfo => {
  return {
    id: comment.issueId,
    service: comment.service,
  }
}

api.generateMirrorSignature = (originalEntity: Entity, targetService): string => {
  return api.getMetaAsEntityHtmlComment ({
    id: originalEntity.id,
    service: originalEntity.service,
    issueId: originalEntity.issueId,
  }, targetService)
}

api.getMetaAsEntityHtmlComment = (meta: Object, targetService: string): string => {
  let entityHtmlComment = api.wrapStringToHtmlComment (
    `${mirrorMetaVarName}=${JSON.stringify (meta)}`)

  switch (targetService) {
    case "youtrack": return `\n\n{html}${entityHtmlComment}{html}`
    case "github": return `\n\n${entityHtmlComment}`
  }
},

api.wrapStringToHtmlComment = (str: string): string => {
  return `<!--${str}-->`
}

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
