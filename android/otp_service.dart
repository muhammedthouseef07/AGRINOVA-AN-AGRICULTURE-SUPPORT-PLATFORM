import 'dart:convert';
import 'package:http/http.dart' as http;

/// Result object for OTP requests containing status and user-friendly message
class OtpResult {
  final bool success;
  final String message;

  OtpResult({required this.success, required this.message});
}

/// Service class to communicate securely with the Agrinova backend
/// (Firebase Cloud Functions) for Twilio OTP dispatch and verification.
///
/// Credentials are kept securely on the server and are NEVER exposed to the client.
class OtpService {
  /// Base URL of deployed Firebase Cloud Functions for project agrinova-7550f.
  /// When running locally with Firebase emulator, update to:
  ///   - Android emulator: 'http://10.0.2.2:5001/agrinova-7550f/us-central1'
  ///   - iOS / Web / Physical: 'http://localhost:5001/agrinova-7550f/us-central1'
  static String baseUrl =
      'https://us-central1-agrinova-7550f.cloudfunctions.net';

  /// Request the backend to dispatch an OTP SMS via Twilio
  static Future<OtpResult> sendOtpWithResult({
    required String phoneNumber,
    String purpose = 'verification',
  }) async {
    try {
      final cleanPhone = phoneNumber.replaceAll(RegExp(r'\D'), '');
      if (cleanPhone.length != 10) {
        return OtpResult(
          success: false,
          message: 'Please enter a valid 10-digit phone number',
        );
      }

      final url = Uri.parse('$baseUrl/sendOtp');
      final response = await http
          .post(
            url,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'phoneNumber': cleanPhone,
              'purpose': purpose,
            }),
          )
          .timeout(const Duration(seconds: 15));

      final Map<String, dynamic> data = jsonDecode(response.body);
      if (response.statusCode == 200 && data['success'] == true) {
        return OtpResult(
          success: true,
          message: data['message'] ?? 'OTP sent successfully',
        );
      } else {
        return OtpResult(
          success: false,
          message: data['message'] ?? 'Failed to send OTP. Please try again.',
        );
      }
    } catch (e) {
      return OtpResult(
        success: false,
        message: 'Network error or backend unavailable. Please try again.',
      );
    }
  }

  /// Request the backend to verify the submitted OTP
  static Future<OtpResult> verifyOtpWithResult({
    required String phoneNumber,
    required String code,
  }) async {
    try {
      final cleanPhone = phoneNumber.replaceAll(RegExp(r'\D'), '');
      final cleanCode = code.trim();

      if (cleanCode.length != 6) {
        return OtpResult(
          success: false,
          message: 'Please enter a valid 6-digit OTP',
        );
      }

      final url = Uri.parse('$baseUrl/verifyOtp');
      final response = await http
          .post(
            url,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'phoneNumber': cleanPhone,
              'code': cleanCode,
            }),
          )
          .timeout(const Duration(seconds: 15));

      final Map<String, dynamic> data = jsonDecode(response.body);
      if (response.statusCode == 200 && data['success'] == true) {
        return OtpResult(
          success: true,
          message: data['message'] ?? 'OTP verified successfully',
        );
      } else {
        return OtpResult(
          success: false,
          message: data['message'] ?? 'Invalid OTP. Please try again.',
        );
      }
    } catch (e) {
      return OtpResult(
        success: false,
        message: 'Network error or backend unavailable. Please try again.',
      );
    }
  }

  /// Helper returning boolean for straightforward integration
  static Future<bool> sendOtp({
    required String phoneNumber,
    String purpose = 'verification',
  }) async {
    final result = await sendOtpWithResult(
      phoneNumber: phoneNumber,
      purpose: purpose,
    );
    return result.success;
  }

  /// Helper returning boolean for straightforward integration
  static Future<bool> verifyOtp({
    required String phoneNumber,
    required String code,
  }) async {
    final result = await verifyOtpWithResult(
      phoneNumber: phoneNumber,
      code: code,
    );
    return result.success;
  }
}
