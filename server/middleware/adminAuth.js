// Token-based admin auth middleware. Requires ADMIN_TOKEN env var.
export function adminAuth(c, next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    return c.json({ ok: false, error: 'ADMIN_TOKEN not configured on server' }, 500);
  }
  const authHeader = c.req.header('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (bearer !== token) {
    return c.json({ ok: false, error: 'Invalid or missing admin token' }, 401);
  }
  return next();
}
