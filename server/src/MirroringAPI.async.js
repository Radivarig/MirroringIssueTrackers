import serverAPI from './serverAPI.js'

export default serverAPI

export const asyncTimeout = async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const getAllIssues = serverAPI.getAllIssues
export const deleteEntity = serverAPI.deleteEntity
export const createMirror = serverAPI.createMirror
export const getEntity = serverAPI.getEntity

export const getIsOriginalEqualToMirror = serverAPI.getIsOriginalEqualToMirror
export const areLabelsEqual = serverAPI.areLabelsEqual
export const updateMirror = serverAPI.updateMirror
export const getPreparedMirrorEntityForUpdate = serverAPI.getPreparedMirrorEntityForUpdate
