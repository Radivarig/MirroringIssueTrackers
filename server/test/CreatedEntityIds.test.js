import CreatedEntityIds from '../src/CreatedEntityIds.js'
import {expect} from 'chai'

import {
  EntityService,
} from '../src/types'

let createdEntityIds

beforeEach (()=> {
  createdEntityIds = new CreatedEntityIds ()
})

describe('CreatedEntityIds', () => {
  const issue1: EntityService = {id: "1", service: "a"}
  const issue2: EntityService = {id: "2", service: "a"}

  describe('length', () => {
    it ('returns number of entity ids', () => {
      expect (createdEntityIds.length).to.equal (0)
      createdEntityIds.add (issue1)
      expect (createdEntityIds.length).to.equal (1)
      createdEntityIds.add (issue2)
      expect (createdEntityIds.length).to.equal (2)
    })
  })
  
  describe('add', () => {
    it ('stores entity id', () => {
      expect (createdEntityIds.contains (issue1)).to.equal (false)
      createdEntityIds.add (issue1)
      expect (createdEntityIds.contains (issue1)).to.equal (true)
    })

    it ('stores single entity id for multiple adds', () => {
      expect (createdEntityIds.contains (issue1)).to.equal (false)
      createdEntityIds.add (issue1)
      expect (createdEntityIds.length).to.equal (1)
      createdEntityIds.add (issue1)
      expect (createdEntityIds.length).to.equal (1)
    })
  })

  describe('contains', () => {
    it ('returns boolean for is entity id stored', () => {
      expect (createdEntityIds.contains (issue1)).to.equal (false)
      createdEntityIds.add (issue1)
      expect (createdEntityIds.contains (issue1)).to.equal (true)
    })
  })
})
