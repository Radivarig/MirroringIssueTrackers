import {
  EntityService,
} from './types'

import {
  getUniqueEntityId,
} from "./MirroringAPI.js"

export default class CreatedEntityIds {
  obj: Object = {}

  contains (entity: EntityService): boolean {
    const uniqueId: string = getUniqueEntityId (entity)
    return this.obj[uniqueId] !== undefined
  }

  get length (): number {
    return Object.keys(this.obj).length
  }

  add (entities: EntityService | Array <EntityService>): void {
    if (!Array.isArray (entities))
      entities = [entities]

    for (const entity of entities) {
      const uniqueId: string = getUniqueEntityId (entity)
      this.obj[uniqueId] = true
    }
  }

}
