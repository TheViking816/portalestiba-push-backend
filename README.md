# portalestiba-push-backend

Endpoints principales:
- `POST /api/create-checkout-session`
- `POST /api/create-portal-session`
- `POST /api/stripe-webhook`

Admin:
- `POST /api/stripe-webhook?action=reconcile` (requiere `ADMIN_SECRET`)
