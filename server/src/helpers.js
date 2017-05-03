export const throwIfValueNotAllowed = (value, allowed: Array) => {
  if (allowed.indexOf (value) === -1)
    throw `Parameter \`${value}\` has to be: ${allowed.join (" | ")}`
}
