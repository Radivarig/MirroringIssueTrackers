import {
  Issue,
  IssueComment,
  IssueInfo,
  IssueCommentInfo,
  EntityInfo,
  Service,
} from './types'

import {
  services,
} from '../config/const.config.js'

import EntityIdsHolder from './EntityIdsHolder.js'
import {
  isOriginal,
  getOriginalInfo,
  getIssueIdFromRequestBody,
  doListsContainSameElements,
  asyncTimeout,
} from './MirroringAPI.js'

import {
  getIssues,
  deleteEntity,
  getEntity,
} from './MirroringAPI.async.js'

// TEMPORARY
import serverAPI from './serverAPI'
/*createMirror,
updateMirror,
isOriginalEqualToMirror,
getPreparedMirror,
*/

import "colors"
// eslint-disable-next-line no-console
const log = (...args) => console.log (...args)
const entityLog = (entity: EntityInfo) => `${entity.service}_${entity.id} ${entity.issueId ? entity.issueId : ""}`.yellow

export default class MirroringEngine {
  inProgress: boolean = false
  issueInfosQueue: EntityIdsHolder = new EntityIdsHolder ()
  sinceTimestamps: Object = {}

  handleWebhook = async (service: Service, req: Object, res: Object): void => {
    if (service === "youtrack") {
      res.send () // respond so that youtrack doesn't hang...
      await asyncTimeout (1000) // give youtrack time to receive res.send()...
    }

    const issueId: string | void = getIssueIdFromRequestBody (service, req.body)

    if (!issueId)
      return

    log ("Webhook issue:".yellow, service, issueId, (req.body.action || "").blue)

    // ... get webhook issue info
    const webhookIssue: IssueInfo = {service, id: issueId}

    // add timestamp to select last mirror or original
    webhookIssue.timestamp = new Date().getTime ()
    this.issueInfosQueue.add (webhookIssue)

    await this.doMirroring ()
  }

  doMirroring = async (): void => {
    if (this.inProgress)
      return

    this.inProgress = true

    // allow muplitple consecutive webhooks to take place
    await asyncTimeout (2000)

    const origsStore: EntityIdsHolder = new EntityIdsHolder ()
    const mirrorsStore: EntityIdsHolder = new EntityIdsHolder ()
    const queue: EntityIdsHolder = new EntityIdsHolder ()

    // clone to var and clear issueInfosQueue
    const issueInfosQueue = new EntityIdsHolder (this.issueInfosQueue)
    this.issueInfosQueue.reset ()

    const _allIssues = await Promise.all (services.map (async (service) => await getIssues (service, this.sinceTimestamps[service])))
    const allIssues: Array<Issue> = _allIssues.reduce ((a,b) => a.concat (b), [])

    for (const issue of allIssues) {
      if (issueInfosQueue.contains (issue))
        issue.timestamp = issueInfosQueue.get (issue).timestamp

      if (isOriginal (issue))
        origsStore.add (issue)
      else mirrorsStore.add (issue)
    }
    // assign original.mirror and mirror.original
    for (const mirrorIssue of mirrorsStore.list) {
      const origIssue: Issue | void = origsStore.get (getOriginalInfo (mirrorIssue))

      // if no original exist -> it was removed
      if (!origIssue) {
        log ("Deleting mirror".red, entityLog (mirrorIssue))
        await deleteEntity (mirrorIssue)
      }
      else {
        origIssue.mirror = mirrorIssue
        mirrorIssue.original = origIssue
      }
    }

    // if issueInfosQueue is empty fill queue with all origs from origsStore
    if (issueInfosQueue.length === 0) {
      for (const issue of origsStore.list)
        queue.add (issue)
    }
    else {
      // pick only issues from queue, select latest counterpart if both
      for (const issueInfo of issueInfosQueue.list) {
        const origIssue = origsStore.get (issueInfo)
        if (origIssue) {
          if (!origIssue.mirror || !issueInfosQueue.contains (origIssue.mirror) ||
            origIssue.timestamp > origIssue.mirror.timestamp)
            queue.add (origIssue)
        }
        else {
          const mirrorIssue = mirrorsStore.get (issueInfo)
          if (mirrorIssue) {
            if (!mirrorIssue.original || !issueInfosQueue.contains (mirrorIssue.original) ||
              mirrorIssue.timestamp > mirrorIssue.original.timestamp)
              queue.add (mirrorIssue)
          }
        }
      }
    }

    // TEMPORARY inject getCounterpartInfo for getting hierarchy
    serverAPI.getCounterpartInfo = (entity: EntityInfo): EntityInfo | void => {
      const match = origsStore.get (entity) || mirrorsStore.get (entity)
      return match.mirror || match.original
    }

    for (const issue of queue.list) {
      log (entityLog (issue))
      if (isOriginal (issue)) {
        if (!issue.mirror) {
          log ("Create", entityLog (issue))
          const newMirrorInfo: IssueInfo = await serverAPI.createMirror (issue)
          const newMirror: Issue = await getEntity (newMirrorInfo)
          issue.mirror = newMirror
        }
        else {
          // if orig not equal to mirror
          if (!serverAPI.isOriginalEqualToMirror (issue, issue.mirror)) { // eslint-disable-line
            log ("Update", entityLog (issue))
            await serverAPI.updateMirror (issue)
          }
          else log ("Skip", entityLog (issue))
        }
      }
      else {
        // update original
        const preparedMirror: Issue = serverAPI.getPreparedMirror (issue, issue.original.service)
        const labelsDiff = !doListsContainSameElements (preparedMirror.labels, issue.original.labels)
        const stateDiff = preparedMirror.state !== issue.original.state
        if (labelsDiff || stateDiff)
          await serverAPI.updateMirror (issue, {skipTitle: true, skipBody: true})
      }
      // delete/create/update comments
      await this.doComments (issue)
    }

    this.inProgress = false

    if (this.issueInfosQueue.length > 0)
      return await this.doMirroring ()

    log ("Done")
  }

  doComments = async (issue: Issue): void => {
    const counterpartIssue: Issue = issue.mirror || issue.original

    const origsStore: EntityIdsHolder = new EntityIdsHolder ()
    const mirrorsStore: EntityIdsHolder = new EntityIdsHolder ()

    for (const c of issue.comments) {
      c.parent = issue
      if (isOriginal (c))
        origsStore.add (c)
      else mirrorsStore.add (c)
    }
    for (const c of counterpartIssue.comments) {
      c.parent = counterpartIssue
      if (isOriginal (c))
        origsStore.add (c)
      else mirrorsStore.add (c)
    }

    for (const mirrorComment of mirrorsStore.list) {
      const origComment: IssueComment | void = origsStore.get (getOriginalInfo (mirrorComment))
      // if no original exist -> it was removed
      if (!origComment) {
        log ("Deleting mirror".red, entityLog (mirrorComment))
        await deleteEntity (mirrorComment)
      }
      else {
        origComment.mirror = mirrorComment
        mirrorComment.original = origComment
      }
    }

    for (const origComment of origsStore.list) {
      if (!origComment.mirror) {
        log ("Create".magenta, entityLog (origComment))
        const newMirrorInfo: IssueCommentInfo = await serverAPI.createMirror (origComment)
        const newMirror: IssueComment = await getEntity (newMirrorInfo)
        origComment.mirror = newMirror
        log ({newMirror})
      }
      else {
        if (!serverAPI.isOriginalEqualToMirrorComment (origComment, origComment.mirror)) { // eslint-disable-line
          log ("Update".green, entityLog (origComment))
          await serverAPI.updateMirror (origComment)
        }
        else log ("Skip", entityLog (origComment))
      }
    }
  }
}
