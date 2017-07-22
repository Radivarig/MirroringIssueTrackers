import {
  EntityInfo,
} from './types'

import {
  getUniqueEntityId,
} from "./entityHelpers"

export default class EntityIdsHolder {
  obj: Object = {}

  contains (entity: EntityInfo): boolean {
    const uniqueId: string = getUniqueEntityId (entity)
    return this.obj[uniqueId] !== undefined
  }

  get length (): number {
    return Object.keys(this.obj).length
  }

  add (entities: EntityInfo | Array <EntityInfo>): void {
    if (!Array.isArray (entities))
      entities = [entities]

    for (const entity of entities) {
      const uniqueId: string = getUniqueEntityId (entity)
      this.obj[uniqueId] = entity
    }
  }

  remove (entities: EntityInfo | Array <EntityInfo>): void {
    if (!Array.isArray (entities))
      entities = [entities]

    for (const entity of entities) {
      const uniqueId: string = getUniqueEntityId (entity)
      delete this.obj[uniqueId]
    }
  }

}
