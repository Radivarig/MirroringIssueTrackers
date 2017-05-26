export const throwIfValueNotAllowed = (value, allowed: Array) => {
  if (allowed.indexOf (value) === -1)
    throw `Parameter \`${value}\` has to be: ${allowed.join (" | ")}`
}

export const formatTimestampAsDuration = (ts: number): string =>
  [ts / 3600, ts % 3600 / 60, ts % 60].map((p) => Math.floor(p)).join (":")

export const getIndexAfterLast = (str: string, inStr: string): number => inStr.lastIndexOf (str) + str.length

export default {
  throwIfValueNotAllowed,
  formatTimestampAsDuration,
  getIndexAfterLast,
}

