import {
  EntityService,
} from './types'

export const getUniqueEntityId = (entity: EntityService): string =>
  [entity.service, entity.id, entity.issueId].join ("_")

