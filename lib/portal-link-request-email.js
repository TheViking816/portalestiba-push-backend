function portalLinkRequestEmail(row) {
  if (row.kind !== 'admin_portal_links_requested') return null;
  if (row.recipient !== 'portalestibavlc@gmail.com' || !/^\d{5}$/.test(row.chapa)) {
    throw new Error('Solicitud de correo de enlaces no válida');
  }
  return {
    to: 'portalestibavlc@gmail.com',
    subject: `App CPE: enlaces del portal pendientes · ${row.chapa}`,
    html: `<h2>Solicitud de enlaces personales</h2><p>La chapa <strong>${row.chapa}</strong> ha guardado su contraseña del portal para preparar sus enlaces personales.</p><p>La contraseña está disponible para el administrador en Supabase Vault. Accede manualmente al portal, obtén los enlaces y guárdalos para la próxima sincronización.</p><p>No se ha iniciado ningún acceso automático al portal. Este correo no contiene la contraseña.</p>`
  };
}
module.exports = { portalLinkRequestEmail };
