# Deployment

### Vercel (Recommended)
```bash
vercel --prod
```
- Set environment variables in Vercel dashboard
- Ensure Supabase URL uses HTTPS
- Enable Realtime in Supabase dashboard before deployment

### Post-Deployment Checklist
- Verify RLS policies are active in production
- Test real-time subscriptions work
- Confirm authentication flow (login/logout)
- Check all user roles have appropriate access
- Monitor Supabase usage and API rate limits
