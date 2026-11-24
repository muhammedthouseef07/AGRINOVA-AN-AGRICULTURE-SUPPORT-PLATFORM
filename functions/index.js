/**
 * AGRINOVA - Agriculture Support Platform
 * Firebase Cloud Functions for Secure Twilio OTP Authentication
 *
 * This backend service manages OTP generation, SMS dispatch via Twilio,
 * and server-side verification. Sensitive Twilio credentials are kept
 * strictly on the server and are NEVER exposed to client applications.
 */

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const cors = require("cors")({ origin: true });
const twilio = require("twilio");
const crypto = require("crypto");

// Initialize Firebase Admin SDK
admin.initializeApp();
const db = admin.firestore();

/**
 * Retrieve configuration securely from environment variables
 * Supports both process.env and Firebase parameterized secrets
 */
function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !twilioNumber) {
    throw new Error(
      "Missing Twilio environment configuration. Ensure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are configured in backend environment."
    );
  }

  return { accountSid, authToken, twilioNumber };
}

/**
 * Cloud Function: sendOtp
 * Generates a cryptographically random 6-digit OTP, saves it with a 5-minute
 * expiration in Firestore (otpVerifications collection), and delivers it via Twilio SMS.
 */
exports.sendOtp = onRequest({ cors: true }, (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        message: "Method Not Allowed. Use POST.",
      });
    }

    try {
      const { phoneNumber, purpose } = req.body || {};

      if (!phoneNumber || typeof phoneNumber !== "string") {
        return res.status(400).json({
          success: false,
          message: "A valid phone number is required.",
        });
      }

      // Sanitize phone number (extract digits only)
      const cleanPhone = phoneNumber.replace(/\D/g, "");
      if (cleanPhone.length !== 10) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid 10-digit Indian phone number.",
        });
      }

      const { accountSid, authToken, twilioNumber } = getTwilioConfig();
      const client = twilio(accountSid, authToken);

      // Generate cryptographically secure 6-digit OTP
      const otp = crypto.randomInt(100000, 1000000).toString();

      // Format E.164 destination number
      const formattedTo = `+91${cleanPhone}`;

      // Customize message text based on purpose
      let messageBody;
      if (purpose === "aadhaar") {
        messageBody = `Your Agrinova Aadhaar verification code is ${otp}. Valid for 5 minutes.`;
      } else {
        messageBody = `Your Agrinova Phone number verification code is ${otp}. Valid for 5 minutes.`;
      }

      // Send SMS via Twilio API
      await client.messages.create({
        body: messageBody,
        from: twilioNumber,
        to: formattedTo,
      });

      // Securely store OTP record in Firestore (inaccessible to direct client access)
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes validity

      await db.collection("otpVerifications").doc(cleanPhone).set({
        otp: otp,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
        purpose: purpose || "verification",
        attempts: 0,
      });

      return res.status(200).json({
        success: true,
        message: "OTP sent successfully.",
      });
    } catch (error) {
      console.error("Error in sendOtp:", error.message || error);
      return res.status(500).json({
        success: false,
        message:
          error.message && !error.message.includes("TWILIO")
            ? error.message
            : "Failed to send OTP. Please check service configuration and try again.",
      });
    }
  });
});

/**
 * Cloud Function: verifyOtp
 * Verifies submitted OTP against the server-stored record.
 * Handles rate-limiting attempts, single-use invalidation, and expiration.
 */
exports.verifyOtp = onRequest({ cors: true }, (req, res) => {
  cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        message: "Method Not Allowed. Use POST.",
      });
    }

    try {
      const { phoneNumber, code } = req.body || {};

      if (!phoneNumber || !code) {
        return res.status(400).json({
          success: false,
          message: "Both phone number and OTP code are required.",
        });
      }

      const cleanPhone = String(phoneNumber).replace(/\D/g, "");
      const cleanCode = String(code).trim();

      if (cleanCode.length !== 6) {
        return res.status(400).json({
          success: false,
          message: "OTP code must be 6 digits.",
        });
      }

      const docRef = db.collection("otpVerifications").doc(cleanPhone);
      const doc = await docRef.get();

      if (!doc.exists) {
        return res.status(400).json({
          success: false,
          message: "No active OTP found or already used. Please request a new OTP.",
        });
      }

      const data = doc.data();

      // Check max failed attempts (prevents brute-force attacks)
      const attempts = data.attempts || 0;
      if (attempts >= 5) {
        await docRef.delete();
        return res.status(429).json({
          success: false,
          message: "Too many failed attempts. Please request a new OTP.",
        });
      }

      // Check expiration
      const expiresAt = data.expiresAt ? data.expiresAt.toDate() : null;
      if (!expiresAt || new Date() > expiresAt) {
        await docRef.delete();
        return res.status(400).json({
          success: false,
          message: "OTP has expired. Please request a new one.",
        });
      }

      // Check OTP match
      if (data.otp === cleanCode) {
        // Invalidate OTP immediately so it cannot be replayed
        await docRef.delete();

        return res.status(200).json({
          success: true,
          message: "OTP verified successfully.",
        });
      } else {
        // Increment failed attempts
        await docRef.update({
          attempts: admin.firestore.FieldValue.increment(1),
        });

        return res.status(400).json({
          success: false,
          message: "Invalid OTP. Please check and try again.",
        });
      }
    } catch (error) {
      console.error("Error in verifyOtp:", error.message || error);
      return res.status(500).json({
        success: false,
        message: "Error verifying OTP. Please try again.",
      });
    }
  });
});
