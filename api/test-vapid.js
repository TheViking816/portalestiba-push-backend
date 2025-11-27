// api/test-vapid.js
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    const publicKey = process.env.VAPID_PUBLIC_KEY || 'NOT_SET';
    const privateKey = process.env.VAPID_PRIVATE_KEY || 'NOT_SET';

    return res.status(200).json({
        vapid_public_key: publicKey,
        vapid_private_key_length: privateKey.length,
        vapid_private_key_preview: privateKey.substring(0, 10) + '...',
        web_push_email: process.env.WEB_PUSH_EMAIL || 'NOT_SET'
    });
};
