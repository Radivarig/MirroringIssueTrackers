import {
  Entity,
  EntityService,
  EntityMapping,
} from "./types"

export class Mapping {
  mappings = []

  getEntityService (knownEntityService: EntityService, targetService: string) {
    for (let i = 0; i < this.mappings.length; ++i) {
      const mapping: EntityMapping = this.mappings[i]

      for (let j = 0; j < mapping.services.length; ++j) {
        const entityService: EntityService = mapping.services[j]

        // if we found known EntityService, return targetService
        if (entityService.service === knownEntityService.service &&
          entityService.id === knownEntityService.id)
          return mapping.services.filter ((f) => f.service === targetService)[0]
      }
    }
  }

  removeMappingContaining (containsObj: Object) {
    this.mappings = this.mappings.filter ((m) => {
      const serviceContainsAllProperties = m.services.filter (
        (s) => {
          for (const p in containsObj) {
            if (s[p] !== containsObj[p]) {
              return false
            }
          }
          return true
        }
      )[0] !== undefined
      return !serviceContainsAllProperties
    })
  }

  add (newEntity: Entity, knownEntityService: EntityService | void, assignToMapping: Object = {}) {
    for (let i = 0; i < this.mappings.length; ++i) {
      const mapping: EntityMapping = this.mappings[i]

      for (let j = 0; j < mapping.services.length; ++j) {
        const s = mapping.services[j]
        // if already exist
        if (s.service === newEntity.service && s.id === newEntity.id) {
          Object.assign (mapping, assignToMapping)
          Object.assign (s, newEntity)
          return
        }
      }

      const knownMatch = knownEntityService && mapping.services.filter ((f) =>
        f.service === knownEntityService.service && f.id === knownEntityService.id
      )[0]

      if (knownMatch) {
        // assign
        Object.assign (mapping, assignToMapping)
        // append service
        mapping.services.push (newEntity)
        return
      }
    }

    if (knownEntityService) {
      console.log ("Known entity service not found: ", knownEntityService)
      return
    }

    // create new mapping
    const newEntityMapping: EntityMapping = {services: []}

    // fill services
    if (knownEntityService)
      newEntityMapping.services.push (knownEntityService)
    newEntityMapping.services.push (newEntity)

    // assign
    Object.assign (newEntityMapping, assignToMapping)
    // create mapping
    this.mappings.push (newEntityMapping)

  }

}
/*
  @computed get report () {
    if (this.todos.length === 0)
      return "<none>"
    return `Next todo: "${this.todos[0].task}". ` +
      `Progress: ${this.completedTodosCount}/${this.todos.length}`
  }
*/

export default class Store {
  issueMappings = new Mapping ()
  commentMappings = new Mapping ()
}
