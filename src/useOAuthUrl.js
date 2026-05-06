// useOAuthUrl.js — Gera URL de autenticação OAuth da Meta
export function useOAuthUrl() {
  const APP_ID   = import.meta.env.VITE_META_APP_ID;
  const REDIRECT = encodeURIComponent(window.location.origin + "/api/auth-callback");
  const SCOPE    = "instagram_basic,instagram_content_publish,instagram_manage_insights,pages_read_engagement,pages_show_list,pages_manage_posts,business_management,pages_manage_metadata";

  const oauthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${APP_ID}&redirect_uri=${REDIRECT}&scope=${SCOPE}&response_type=code`;

  return { oauthUrl };
}
