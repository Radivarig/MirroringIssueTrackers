import type {
  AuthConfig,
  Issue,
  IssueComment,
  Entity,
  EntityService,
  EntityInfo,
  EntityMapping,
  DoSingleEntityAction,
  Service,
} from './types'

import {
  isOriginal,
  getMeta,
  doListsContainSameElements,
  generateMirrorSignature,
  convertMentions as convertMentionsRaw,
  getTitlePrefix,
} from './MirroringAPI.js'

import "colors"
import normalizeNewline from 'normalize-newline'

import integrationRest from "./integrationRest"

let startTime

import {
  asyncTimeout,
  throwIfValueNotAllowed,
  getIndexAfterLast,formatTimestampAsDuration,
} from './helpers'

// import auth from "../config/auth.config"
const auth: AuthConfig = require ("../config/auth.config").default
import {
  services,
  forceMirroringTag,
  mirrorMetaVarName,
  closedStateField,
} from '../config/const.config'

import settings from "../config/settings.config"

import UsernameMapping, {UsernameInfo, KnownUsernameInfo} from './UsernameMapping'
const usernameInfos: Array<UsernameInfo> = require('../config/usernames.config').default
const usernameMapping = new UsernameMapping (usernameInfos)

let testTimestamps
import CreatedEntityIds from "./CreatedEntityIds"
const createdEntityIds = new CreatedEntityIds ()

const log = (...args) => {console.log(...args)} // eslint-disable-line no-console

const webhookHandler = {
  getIssues: async (service: Service, since: number | void) => {
    const projectIssues: Array<Issue> = await webhookHandler.getProjectIssues (service, since)

    let filteredIssues

    switch (service) {
      case "youtrack": {
        filteredIssues = projectIssues.filter ((issue) => {
          // include mirrors
          if (isOriginal (issue) === false)
            return true

          // include forcemirror tagged
          const hasForceMirroringTag = issue.tags && issue.tags.indexOf (forceMirroringTag) !== -1
          if (hasForceMirroringTag)
            return true

          // exclude blacklisted
          const isYoutrackBlacklisted = webhookHandler.getIsIssueBlacklistedByTags (issue)
          if (isYoutrackBlacklisted)
            return false

          // exclude sensitive
          const isSensitive = webhookHandler.getEntityContainsSensitiveInfo (issue)
          if (isSensitive)
            return false

          // include all other originals
          return true
        })
        break
      }
      case "github": {
        // reverse since github sends descending order
        filteredIssues = projectIssues.reverse ().filter ((issue) => {
          if (isOriginal (issue))
            return true

          const meta = getMeta (issue) || {}
          return !meta.deleted
        })
      }
        break
    }
    return filteredIssues
  },

  getEntitiesWithOriginalsFirst: (sourceList: Array<Entity>): Array<Entity> => {
    const originals = []
    const mirrors = []

    sourceList.forEach ((entity) => {
      if (isOriginal (entity))
        originals.push (entity)
      else mirrors.push (entity)
    })
    return originals.concat (mirrors)
  },

  getTimestampOfLastIssue: async (targetService: string): number => {
    switch (targetService) {
      case "youtrack": {
        const rawIssue = await integrationRest ({
          service: targetService,
          method: "get",
          url: `issue/byproject/${auth.youtrack.project}`,
          query: {
            max: 100000,
          },
        })
        .then ((response) => response.body[response.body.length - 1])

        let createTs = 0
        rawIssue && rawIssue.field.forEach ((f) => {
          if (f.name === "created")
            createTs = webhookHandler.convertTimestamp (f.value, targetService)
        })
        return createTs
      }

      case "github": {
        const rawIssue = await integrationRest ({
          service: "github",
          method: "get",
          url: `repos/${auth.github.user}/${auth.github.project}/issues`,
          query: {
            state: "all",
            per_page: 1,
          },
        })
        .then ((response) => response.body[0])

        let createTs = 0
        if (rawIssue)
          createTs = webhookHandler.convertTimestamp (rawIssue.created_at, targetService)
        return createTs
      }
    }
  },

  getProjectIssues: async (sourceService: string, sinceTimestamp: number | void): Array<Issue> => {
    const query = {}

    switch (sourceService) {
      case "youtrack": {
        query.max = 100000

        if (sinceTimestamp !== undefined)
          query.updatedAfter = sinceTimestamp

        return await webhookHandler.getProjectIssuesRaw (sourceService, query)
      }
      case "github": {
        // NOTE here is specified which issues should be mirrored to Youtrack
        // temporary: this is single direction mirroring, yt -> gh, allowing only changes of mirrors
        /*
        const openQuery = {state: "open", labels: "Mirroring"}
        const closedQuery = {state: "closed", labels: "Mirroring"}

        const openIssues = await webhookHandler.getProjectIssuesRaw (sourceService, openQuery)
        const closedIssues = await webhookHandler.getProjectIssuesRaw (sourceService, closedQuery)
        return openIssues.concat (closedIssues)
        */
        query.state = "all"
        query.per_page = 100

        if (sinceTimestamp !== undefined) {
          // NOTE +1000 as github ignores milliseconds
          query.since = new Date(sinceTimestamp + 1000).toISOString()
        }

        return await webhookHandler.getProjectIssuesRaw (sourceService, query)
      }
    }
  },

  //composeYoutrackId: (id: string): string => `${auth.youtrack.project}-${id}`,
  //extractYoutrackId: (fullId: string): string => fullId.split("-")[1],

  githubPaginationRest: async (params: Object): Array<Object> => {
    let linksObj
    const rawList = await integrationRest (params)
    .then ((response) => {linksObj = response.links; return response.body})
    .catch ((err) => {throw err})

    if (linksObj && linksObj.last) {
      const lastUrl = linksObj.last
      const urls = []
      const afterUrlIndex = getIndexAfterLast (`${auth.github.url}/`, lastUrl)
      const afterPageEqIndex = getIndexAfterLast ("page=", lastUrl)
      const pagesCount/*: number */= Number.parseInt (lastUrl.substring (afterPageEqIndex))

        // starting from 2, already have page1 issues,
        // including pagesCount as page1 is first not page0,
        // +1 to get extra page just to be sure (new issue pushes another to last+1 page)
      for (let i = 2; i <= pagesCount + 1; ++i) {
        const url = lastUrl.substring (afterUrlIndex, afterPageEqIndex) + i
        urls.push (url)
      }
      const linksParams = {
        service: "github",
        method: "get",
      }
      await Promise.all (urls.map (async (url) => {
        const perPageElements = await integrationRest ({...linksParams, url})
          .then ((response) => response.body)
          .catch ((err) => {throw err})

        rawList.push (...perPageElements)
      }))
      return rawList
    }
    return rawList
  },

  getProjectIssuesRaw: async (sourceService: string, query: Object | void): Array<Issue> => {
    const commonParams = {
      service: sourceService,
      method: "get",
      query,
    }

    let rawIssues: Array<Object> = []

    switch (sourceService) {
      case "youtrack": {
        rawIssues = await integrationRest ({
          ...commonParams,
          url: `issue/byproject/${auth.youtrack.project}`,
        })
        .then ((response) => response.body)
        .catch ((err) => {throw err})

        return rawIssues.map ((rawIssue) => {
          const issue = webhookHandler.getFormatedIssue (sourceService, rawIssue)
          issue.comments = (rawIssue.comment || []).map ((rawComment) =>
            webhookHandler.getFormatedComment (issue, rawComment))
          return issue
        })
      }

      case "github": {
        // commonParams.sort = "created" // have to do it manually anyway (async per page)
        rawIssues = await webhookHandler.githubPaginationRest ({
          ...commonParams,
          url: `repos/${auth.github.user}/${auth.github.project}/issues`,
        })

        // exclude pull requests
        rawIssues = rawIssues.filter ((ri) => !ri.pull_request)

        // get all github comments
        const allGithubComments = await webhookHandler.githubPaginationRest ({
          ...commonParams,
          url: `repos/${auth.github.user}/${auth.github.project}/issues/comments`,
        })

        const issueIdCommentsMap = {}
        allGithubComments.forEach ((rawComment) => {
          const ind1 = getIndexAfterLast ("/issues/", rawComment.html_url)
          const ind2 = rawComment.html_url.lastIndexOf ("#")
          const issueId = rawComment.html_url.substring (ind1, ind2)

          issueIdCommentsMap[issueId] = issueIdCommentsMap[issueId] || []
          issueIdCommentsMap[issueId].push (rawComment)
        })

        return rawIssues.map ((rawIssue) => {
          const issue = webhookHandler.getFormatedIssue (sourceService, rawIssue)
          const issueId = rawIssue.number.toString ()
          issue.comments = (issueIdCommentsMap[issueId] || []).map ((rawComment) =>
            webhookHandler.getFormatedComment (issue, rawComment))
          return issue
        })
      }
    }
  },

  getIssueIdFromRequestBody: (sourceService: string, reqBody: Object): string | void => {
    if (sourceService === "youtrack") return reqBody.issueId.toString ()
    if (sourceService === "github") return reqBody.issue && reqBody.issue.number.toString ()
  },

  getIdFromRawIssue: (sourceService: string, rawIssues: Object): string => {
    if (sourceService === "youtrack") return rawIssues.id.toString ()
    if (sourceService === "github") return rawIssues.number.toString ()
  },

  getFormatedTimeFromStart: (): string => {
    const dt = (new Date().getTime () - startTime) / 1000
    return formatTimestampAsDuration (dt)
  },

  getEntityContainsSensitiveInfo: (entity: Entity): boolean => {
    for (let i = 0; i < settings.sensitiveStrings.length; ++i) {
      const str = settings.sensitiveStrings[i]
      if (entity.body.toLowerCase ().indexOf (str.toLowerCase ()) !== -1) {
        log ("Issue contains sensitive info, omitting".red, str, webhookHandler.entityLog (entity))
        return true
      }
    }
  },

  getIsIssueBlacklistedByTags: (issue: Issue): boolean => {
    // if issue not from youtrack
    if (!issue.tags)
      return false

      // if tags contain force mirroring tag
    if (issue.tags.indexOf (forceMirroringTag) !== -1)
      return false

      // if intersection
    for (let i = 0; i < issue.tags.length; ++i) {
      const tag: string = issue.tags[i]

      if (settings.mirroringBlacklistTags.indexOf (tag) !== -1) {
        log ("Issue is blacklisted for mirroring".grey, webhookHandler.entityLog (issue))
        return true
      }
    }
    // no intersection
    return false
  },

  getCounterpartInfo: () => {
    log ("Temporary fix for hierarchy: getCounterpartInfo has to be assigned to serverAPI")},

  getGithubCounterparts: (issueIds: Array<string>): Array<string> =>
    issueIds.map ((issueId) => {
      const knownEntityService = {service: "youtrack", id: issueId}
      const counterpart = webhookHandler.getCounterpartInfo (knownEntityService)
      return counterpart && counterpart.id
    }).filter (Boolean),

  getHierarchyStringBlock: (issue: Issue): string => {
    let s = ""
    if (issue.parentFor || issue.subtaskOf) {
      const parentForGithubIssues = webhookHandler.getGithubCounterparts (issue.parentFor || [])
      const subtaskOfGithubIssues = webhookHandler.getGithubCounterparts (issue.subtaskOf || [])

      if (parentForGithubIssues.length !== 0 || subtaskOfGithubIssues.length !== 0) {
        s += "\n\n#\n" // make slim horizontal line
        if (parentForGithubIssues.length !== 0)
          s += `<code>Parent for:</code> ${parentForGithubIssues.map ((c) => `#${c}`).join (", ")}\n`
        if (subtaskOfGithubIssues.length !== 0)
          s += `<code>Subtask of:</code> ${subtaskOfGithubIssues.map ((c) => `#${c}`).join (", ")}\n`
      }
    }
    return s
  },

  getNameQuote: (entity: Entity, targetService: string): string =>
    `>@${entity.author} commented:\n\n`,

  getPreparedMirrorComment: (comment: IssueComment, targetService: string): Entity => {
    const nameQuote = webhookHandler.getNameQuote (comment, targetService)
    const signature: string = generateMirrorSignature (comment, targetService)

    const convertedBody =
      webhookHandler.convertMentions (nameQuote + comment.body, comment.service, targetService)

    return {
      ...comment,
      body: convertedBody + signature,
    }
  },

  convertMentions: (body, sourceService, targetService): string =>
    convertMentionsRaw (body, sourceService, targetService, usernameMapping),

  getPreparedMirror: (issue: Issue, targetService: string): Entity => {
    // todo, switch (issue.service) instead
    let labels = issue.fields || issue.tags ? ["Mirroring"] : undefined
    if (issue.fields)
      labels = labels.concat (webhookHandler.getLabelsFromFields (issue.fields))
    if (issue.tags)
      labels = labels.concat (webhookHandler.getLabelsFromTags (issue.tags))

    const hierarchy = webhookHandler.getHierarchyStringBlock (issue)
    const signature = generateMirrorSignature (issue, targetService)

    const nameQuote = webhookHandler.getNameQuote (issue, targetService)
    const titlePrefix = getTitlePrefix (issue, targetService)

    const convertedBody = webhookHandler.convertMentions (nameQuote + issue.body, issue.service, targetService)

    return {
      ...issue,
      title: titlePrefix + issue.title,
      body: convertedBody + hierarchy + signature,
      labels,
    }
  },

  isOriginalEqualToMirrorComment: (originalComment: IssueComment, mirrorComment: IssueComment): boolean => {
    const preparedOriginal: IssueComment = webhookHandler.getPreparedMirrorComment (originalComment, mirrorComment.service)
    return preparedOriginal.body === mirrorComment.body
  },

  isOriginalEqualToMirror: (originalIssue: Issue, mirrorIssue: Issue): boolean => {
    const preparedOriginal: Issue = webhookHandler.getPreparedMirror (originalIssue, mirrorIssue.service)

    const areEqual = (
      preparedOriginal.title === mirrorIssue.title &&
      preparedOriginal.body === mirrorIssue.body &&
      preparedOriginal.state === mirrorIssue.state &&
      doListsContainSameElements (preparedOriginal.labels, mirrorIssue.labels))

    if (!areEqual) log ({preparedOriginal, mirrorIssue}, doListsContainSameElements (preparedOriginal.labels, mirrorIssue.labels))
    return areEqual
  },

  entityLog: (entityService: EntityService): string => {
    const parts = []
    parts.push (entityService.service.yellow)
    parts.push (entityService.id.yellow)
    if (webhookHandler.getIsComment (entityService))
      parts.push ("(comment)".grey)
    if (!isOriginal (entityService))
      parts.push ("(mirror)".grey)
    return parts.join (" ")
  },

  getIsComment: (entityService: EntityService): boolean => entityService.issueId !== undefined,
    //try {const comment: IssueComment = entity}
    //catch (err) {return false}
    //return true

  deleteEntity: async (entity: Entity) => {
    if (webhookHandler.getIsComment (entity))
      await webhookHandler.deleteCommentInstance (entity)
    else await webhookHandler.deleteIssueInstance (entity)
  },

  deleteIssueInstance: async (issue: Issue) => {
    switch (issue.service) {
      case "github": {
        // delete all comments
        const comments: Array<IssueComment> = await webhookHandler.getComments (issue)
        await Promise.all (comments.map (
          async (comment) => await webhookHandler.deleteCommentInstance (comment)))

        const signature: string = webhookHandler.getMetaAsIssueCommentHtmlComment ("github", {deleted: true})
        const data = {
          ...issue,
          title: '(Issue removed)',
          body: signature,
          labels: ["IssueRemoved"],
          state: "closed",
        }

        const restParams = {}
        restParams.service = "github"
        restParams.method = "patch"
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/${issue.id}`
        restParams.data = data

        return await integrationRest(restParams)
        .then ((response) => response.body)
        .catch ((err) => {throw err})
      }
      case "youtrack": {
        // Github issues cannot be deleted, so noop
        // todo: handle case when label "Mirroring" is removed from github original
      }
    }
  },

  deleteCommentInstance: async (comment: IssueComment) => {
    const restParams = {
      service: comment.service,
      method: "delete",
    }
    switch (comment.service) {
      case "youtrack":
        restParams.url = `issue/${comment.issueId}/comment/${comment.id}`
        restParams.query = {permanently: true}
        break
      case "github":
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/comments/${comment.id}`
        break
    }

    // log ("DELETING", restParams)
    await integrationRest (restParams)
    .then ((response) => response.body)
    // TODO: temporary fix for double delete request
    .catch ((err) => {
      if (!err.status === 404)
        throw err
      log ("caught a 404".red)
    })
  },

  updateMirror: async (entity: Entity, opts: Object = {}) => {
    if (webhookHandler.getIsComment (entity))
      await webhookHandler.updateMirrorComment (entity)
    else await webhookHandler.updateMirrorIssue (entity, opts)
  },

  updateMirrorComment: async (comment: IssueComment) => {
    const targetService = comment.service === "youtrack" ? "github" : "youtrack"

    const targetComment = comment.mirror
    const targetParentIssue = comment.mirror.parent

    const preparedComment: IssueComment = webhookHandler.getPreparedMirrorComment (comment, targetService)

    const restParams = {
      service: targetService,
    }

    switch (targetService) {
      case "youtrack":
        restParams.method = "put"
        restParams.url = `issue/${targetParentIssue.id}/comment/${targetComment.id}`
        restParams.data = {text: preparedComment.body}
        break
      case "github":
        restParams.method = "patch"
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/comments/${targetComment.id}`
        restParams.data = {body: preparedComment.body}
        break
    }

    await integrationRest (restParams)
    .then ((response) => response.body)
    .catch ((err) => {throw err})
  },

  getComments: async (sourceIssue: EntityService): Array<IssueComment> => {
    const rawComments = await webhookHandler.getRawComments (sourceIssue)
    return rawComments.map ((rawComment) => webhookHandler.getFormatedComment (sourceIssue, rawComment))
  },

  getRawComments: async (sourceIssue: EntityService): Array<Object> => {
    const restParams = {
      method: "get",
      service: sourceIssue.service,
    }

    switch (sourceIssue.service) {
      case "youtrack": {
        restParams.url = `issue/${sourceIssue.id}/comment`
        break
      }
      case "github": {
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/${sourceIssue.id}/comments`
        break
      }
    }

    const comments = await integrationRest (restParams)
    .then ((response) => response.body)
    .catch ((err) => {throw err})

    return comments
  },

  getComment: async (knownEntityService: EntityService): IssueComment => {
    const restParams = {
      method: "get",
      service: knownEntityService.service,
    }

    switch (knownEntityService.service) {
      case "youtrack":
        restParams.url = `issue/${knownEntityService.issueId}/comment/`
        break
      case "github":
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/comments/${knownEntityService.id}`
        break
    }

    let rawComment = await integrationRest (restParams)
    .then ((response) => response.body)
    .catch ((err) => {throw err})

    if (knownEntityService.service === "youtrack")
      rawComment = rawComment.filter ((f) => f.id === knownEntityService.id)[0]

    return webhookHandler.getFormatedComment (knownEntityService, rawComment)
  },

  getFormatedComment: (sourceIssue: EntityService, rawComment: Object): IssueComment => {
    let body
    const formatedComment = {
      id: rawComment.id.toString(),
      service: sourceIssue.service,
      issueId: sourceIssue.id,
    }
    switch (sourceIssue.service) {
      case "youtrack":
        body = rawComment.text
        formatedComment.author = rawComment.author
        break
      case "github":
        body = rawComment.body
        formatedComment.author = rawComment.user.login
        break
    }

    // replace \r with \n
    formatedComment.body = normalizeNewline (body)

    return formatedComment
  },

  getIssue: async (issueService: EntityService): Issue | void => {
    const restParams = {
      service: issueService.service,
    }

    switch (issueService.service) {
      case "youtrack": {
        restParams.method = "get"
        restParams.url = `issue/${issueService.id}`
        break
      }
      case "github": {
        restParams.method = "get"
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/${issueService.id}`
        break
      }
    }

    const rawIssue = await integrationRest (restParams)
    .then ((response) => response.body)
    .catch ((err) => {
      // catch only if not found
      if (err.status !== 404)
        throw err
    })

    if (!rawIssue)
      return

    const issue: Issue = webhookHandler.getFormatedIssue (issueService.service, rawIssue)

    // add comments
    const issueComments: Array<IssueComment> = await webhookHandler.getComments (issue)

    issue.comments = issueComments
    return issue
  },

  getEntity: async (entityService: EntityService): Entity | void => {
    if (webhookHandler.getIsComment (entityService))
      return await webhookHandler.getComment (entityService)
    return await webhookHandler.getIssue (entityService)
  },

  getLabelsFromTags: (tags/*: Array<{name: string, value: string}>*/): Array<string> =>
    tags.map ((tag) => {
      if (tag !== "Star")
        return `Tag:${tag}`
      return undefined
    }).filter (Boolean),

  getLabelsFromFields: (fields/*: Array<{name: string, value: string}>*/): Array<string> =>
    fields.map ((field) =>
      // add here handles for field.specialAttr
       `${field.name}:${field.value}`),

  convertTimestamp: (value: string, targetService: string): number => {
    switch (targetService) {
      case "github": {
        return new Date (value).getTime()
      }
      case "youtrack": {
        return parseInt (value)
      }
    }
  },

  getFormatedIssue: (service: string, rawIssue: Object): Issue => {
    const issueId: string = webhookHandler.getIdFromRawIssue (service, rawIssue)

    switch (service) {
      case "github": {
        // TODO labels, how to display them on youtrack if source is github,
        // should fields be permitted to change from github if source is youtrack?

        const labels = rawIssue.labels.map ((l) => l.name)

        // filter duplicates, github bug sometimes creates duplicate label
        const uniqueLabels = labels.filter ((l, i) => labels.indexOf (l) === i)

        return {
          service,
          id: rawIssue.number.toString(),
          author: rawIssue.user.login,
          title: rawIssue.title,
          body: normalizeNewline (rawIssue.body),
          labels: uniqueLabels,
          state: webhookHandler.getStateFromRawIssue (service, rawIssue),
          createdAt: webhookHandler.convertTimestamp (rawIssue.created_at, service),
        }
      }
      case "youtrack": {
        let title = ""
        let body = ""
        const fields = []
        const parentFor = []
        const subtaskOf = []
        let author = ""
        let createdAt = 0

        rawIssue.field.forEach ((f) => {
          if (f.name === "summary")
            title = f.value
          else if (f.name === "description")
            body = normalizeNewline (f.value)
          else if (f.name === "reporterName")
            author = f.value
          else if (f.name === "links") {
            f.value.forEach ((l) => {
              if (l.type === "Subtask" && l.role === "subtask of")
                subtaskOf.push (l.value)
              else if (l.type === "Subtask" && l.role === "parent for")
                parentFor.push (l.value)
            })
          }
          else if (f.name === "created")
            createdAt = webhookHandler.convertTimestamp (f.value, service)
          else if (settings.fieldsToIncludeAsLabels.indexOf (f.name) !== -1)
            fields.push (f)
        })

        // log (service, webhookHandler.getStateFromRawIssue (service, rawIssue))

        const state = webhookHandler.getStateFromRawIssue (service, rawIssue)

        return {
          service,
          id: rawIssue.id,
          author,
          title,
          body,
          fields,
          parentFor,
          subtaskOf,
          state,
          createdAt,
          tags: rawIssue.tag.map ((t) => t.value),
        }
      }
    }
  },

  getStateFromRawIssue: (service: string, rawIssue: Object) => {
    switch (service) {
      case "github": return rawIssue.state
      case "youtrack": {
        const stateFromField: string = rawIssue.field.filter ((f) => f.name === "State")[0].value[0]
        const a = settings.closedFieldStateValues.indexOf (stateFromField) !== -1
        return a ? "closed" : "open"
      }
    }

  },

  updateMirrorIssue: async (sourceIssue: EntityService, opts: Object = {}) => {
    const targetService = sourceIssue.service === "youtrack" ? "github" : "youtrack"
    let targetEntityService = sourceIssue.mirror || sourceIssue.original

    const isPostCreation = opts.targetEntityService && opts.targetEntityService.service === targetService
    if (isPostCreation)
      targetEntityService = opts.targetEntityService

    const restParams = {service: targetEntityService.service}

    const preparedIssue: Issue = webhookHandler.getPreparedMirror (sourceIssue, targetService)

    const skipTitle = opts.skipTitle || isPostCreation
    const skipBody = opts.skipBody || isPostCreation

    switch (sourceIssue.service) {
      case "youtrack": {
        restParams.method = "patch"
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/${targetEntityService.id}`

        restParams.data = {
          labels: preparedIssue.labels,
          state: preparedIssue.state,
        }
        if (!skipTitle) restParams.data.title = preparedIssue.title
        if (!skipBody) restParams.data.body = preparedIssue.body

        break
      }
      case "github": {
        if (!skipTitle || !skipBody) {
          restParams.method = "post"
          restParams.url = `issue/${targetEntityService.id}`
          restParams.query = {
            project: auth.youtrack.project,
          }
          if (!skipTitle) restParams.query.summary = preparedIssue.title
          if (!skipBody) restParams.query.description = preparedIssue.body
        }

          // todo: shoulnd't this override with "Open" every time..
        const applyStateParams = {
          service: targetEntityService.service,
          method: "post",
          url: `issue/${targetEntityService.id}/execute`,
          query: {
            command: `State ${preparedIssue.state === "open" ? "Open" : closedStateField}`,
          },
        }

          // apply new state
        await integrationRest(applyStateParams)
          .then ((response) => response.body)
          .catch ((err) => {throw err})

        break
      }
    }

      // if there is nothing to set
    if (sourceIssue.service === "github" && (skipTitle && skipBody))
      return

    return await integrationRest(restParams)
      .then ((response) => response.body)
      .catch ((err) => {throw err})
  },

  createMirrorComment: async (comment: IssueComment): EntityService => {
    const targetService = comment.service === "youtrack" ? "github" : "youtrack"

    const counterpartParentIssue: Issue = comment.parent.mirror || comment.parent.original

    const preparedComment: IssueComment = webhookHandler.getPreparedMirrorComment (comment, targetService)

    return await webhookHandler.createComment (preparedComment, counterpartParentIssue)
  },

  createComment: async (comment: IssueComment, parentIssueService: EntityService): EntityService => {
    const restParams = {
      service: parentIssueService.service,
      method: "post",
    }

    switch (parentIssueService.service) {
      case "youtrack":
        restParams.url = `issue/${parentIssueService.id}/execute`
        restParams.query = {
          comment: comment.body,
        }
        break
      case "github":
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues/${parentIssueService.id}/comments`
        restParams.data = {
          body: comment.body,
        }
        break
    }

    // create comment and get its id
    const newCommentId: string = await integrationRest (restParams)
    .then (async (response) => {
      switch (parentIssueService.service) {
        case "github": {
          return response.body.id.toString ()
        }
        case "youtrack": {
          // youtrack comments can be created only with "execute comment"
          // execute response gives no info
          // so we fetch all comments of parent issue and match it by comments issueId

          const freshIssueComments: Array<IssueComment> = await webhookHandler.getComments (parentIssueService)

          for (const c of freshIssueComments) {
            if (c.issueId === parentIssueService.id)
              return c.id
          }
        }
      }
    })
    .catch ((err) => {throw err})

    return {
      service: parentIssueService.service,
      id: newCommentId,
      issueId: parentIssueService.id,
    }

  },

  getEntityInfoFromUniqueId: (uniqueId: string): EntityInfo => {
    const split = uniqueId.split ("_")
    return {
      service: split[0],
      id: split[1],
      issueId: split[2],
    }
  },

  createMirror: async (entity: Entity): EntityService => {
    if (createdEntityIds.contains (entity)) {
      log ("Recursion for creating".red, webhookHandler.entityLog (entity).yellow)
      throw "Possible recursion".red
    }
    else {
      createdEntityIds.add (entity)
    }

    if (webhookHandler.getIsComment (entity))
      return await webhookHandler.createMirrorComment (entity)
    return await webhookHandler.createMirrorIssue (entity)
  },

  createMirrorIssue: async (sourceIssue: Issue): EntityService => {
    let targetService
    switch (sourceIssue.service) {
      case "youtrack": targetService = "github"; break
      case "github": targetService = "youtrack"; break
    }
    const preparedIssue: Issue = webhookHandler.getPreparedMirror (sourceIssue, targetService)

    return await webhookHandler.createIssue (preparedIssue, targetService)
  },

  createIssue: async (issue: Issue, targetService: string): EntityService => {
    const restParams = {service: targetService}

    switch (targetService) {
      case "github": {
        restParams.method = "post"
        restParams.url = `repos/${auth.github.user}/${auth.github.project}/issues`
        restParams.data = {
          title: issue.title,
          body: issue.body,
          labels: issue.labels,
        }
        break
      }
      case "youtrack": {
        restParams.method = "put"
        restParams.url = "issue"
        restParams.query = {
          // todo: move to sourceIssue.project
          project: auth.youtrack.project,
          summary: issue.title,
          description: issue.body,
        }
        break
      }
    }

    // create issue and get its id
    const newIssueId: string = await integrationRest (restParams)
    .then ((response) => {
      switch (targetService) {
        case "github": {
          return response.body.number.toString ()
        }
        case "youtrack": {
          const loc: string = response.headers.location
          const indexOfLastSlash = loc.lastIndexOf ("/")
          return loc.substring (indexOfLastSlash + 1)
        }
      }
    })
    .catch ((err) => {throw err})

    const newEntityService = {
      service: targetService,
      id: newIssueId,
    }
    // update fields/labels
    await webhookHandler.updateMirrorIssue (issue, {
      targetEntityService: newEntityService,
    })

    return newEntityService
  },

  projectExist: async (projName: string, targetService: string): boolean => {
    const restParams = {
      service: targetService,
      method: "get",
    }

    switch (targetService) {
      case "youtrack":
        restParams.url = `project/all`
        break
      case "github":
        restParams.url = `repos/${auth.github.user}/${projName}`
        break
    }

    const project = await integrationRest (restParams)
      .then ((response) => response.body)
      .catch ((err) => {
        if (err.status !== 404)
          throw err
      })

    if (!project)
      return false

    if (targetService === "github" && project.name.toLowerCase () !== projName.toLowerCase ())
      return false

    if (targetService === "youtrack" &&
      project.filter ((proj) => proj.shortName === projName).length === 0)
      return false

    return true
  },

  throwIfAnyProjectNotExist: async () => {
    await Promise.all (services.map (async (service) => {
      const projName = auth[service].project

      const projExist = await webhookHandler.projectExist (projName, service)
      if (!projExist)
        throw `Test ${service} repository|project not found: ${projName}`
    }))
  },

  generateRandomIssue: (service: string): Issue => {
    const issue: Issue = {
      id: Math.random ().toString (),
      title: Math.random ().toString (),
      body: Math.random ().toString (),
      service,
    }

    // switch (service) {} // fill additional

    return issue
  },

  generateRandomComment: (service: string): IssueComment => {
    const comment: IssueComment = {
      id: Math.random ().toString (),
      body: Math.random ().toString (),
      issueId: Math.random ().toString (),
      service,
    }

    // switch (service) {} // fill additional

    return comment
  },
}

export default webhookHandler
