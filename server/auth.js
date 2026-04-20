import crypto from 'node:crypto'

const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123'

const adminTokens = new Set()

export function adminLogin(username, password) {
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = crypto.randomBytes(24).toString('hex')
    adminTokens.add(token)
    return token
  }
  return null
}

export function isAdminToken(token) {
  return typeof token === 'string' && adminTokens.has(token)
}

export function revokeAdminToken(token) {
  adminTokens.delete(token)
}
