import {
  EntityInfo,
} from './types'

import {
  getUniqueEntityId,
} from "./MirroringAPI.js"

export default class EntityIdsHolder {
  obj: Object = {}

  constructor (toClone: EntityIdsHolder | void) {
    if (toClone)
      Object.assign (this.obj, toClone.obj)
  }

  contains (entity: EntityInfo): boolean {
    const uniqueId: string = getUniqueEntityId (entity)
    return this.obj[uniqueId] !== undefined
  }

  reset () {
    this.obj = {}
  }
  get list (): Array<EntityInfo> {
    return Object.getOwnPropertyNames (this.obj).map ((n) => this.obj[n])
  }

  get (entity: EntityInfo) {
    const uniqueId: string = getUniqueEntityId (entity)
    return this.obj[uniqueId]
  }

  get length (): number {
    return Object.keys(this.obj).length
  }

  add (entity: EntityInfo): void {
    const uniqueId: string = getUniqueEntityId (entity)
    this.obj[uniqueId] = entity
  }

  remove (entity: EntityInfo): void {
    const uniqueId: string = getUniqueEntityId (entity)
    delete this.obj[uniqueId]
  }
}
