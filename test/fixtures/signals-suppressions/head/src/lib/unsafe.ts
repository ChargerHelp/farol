// eslint-disable-next-line no-console
console.log('debug')
// @ts-expect-error legacy API without types
const value = window.legacyApi as any
export const message = 'use // eslint-disable-next-line, @ts-expect-error and as any carefully'
export const template = `/* @ts-ignore */ ${value}`
