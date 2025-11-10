//
//  AudioRecordingService.swift
//  Saturn
//
//  Handles microphone audio capture and streaming
//

import Foundation
@preconcurrency import AVFoundation

/// Manages audio recording from microphone
actor AudioRecordingService {
    // Cross-platform permission status
    enum RecordPermission {
        case granted
        case denied
        case undetermined
    }
    private var audioEngine: AVAudioEngine?
    private var inputNode: AVAudioInputNode?
    private var isRecording = false

    // Callback for audio chunks
    private var onAudioChunk: ((Data) -> Void)?

    /// Start recording audio from microphone
    /// - Parameter onChunk: Callback fired with each audio buffer chunk
    func startRecording(onChunk: @escaping (Data) -> Void) async throws {
        guard !isRecording else { return }

        self.onAudioChunk = onChunk

        try await ensureMicrophonePermission()
        try await configureAudioSession()

        // Setup audio engine
        audioEngine = AVAudioEngine()
        inputNode = audioEngine?.inputNode

        guard let inputNode = inputNode else {
            throw AudioError.noInputNode
        }

        // Use the input node's native format (this is required - can't specify custom format for tap)
        let inputFormat = inputNode.outputFormat(forBus: 0)

        // Install tap on input to capture audio buffers
        // IMPORTANT: Must use the input node's format, not a custom format
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [weak self] buffer, _ in
            Task {
                await self?.processAudioBuffer(buffer)
            }
        }

        guard let audioEngine else {
            throw AudioError.recordingFailed
        }

        do {
            try audioEngine.start()
        } catch {
            throw AudioError.recordingFailed
        }
        isRecording = true
    }

    /// Stop recording and clean up resources
    func stopRecording() async {
        guard isRecording else { return }

        inputNode?.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        inputNode = nil
        isRecording = false

        // Deactivate audio session (iOS only)
        #if os(iOS)
        try? await MainActor.run {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
        #endif
    }

    // MARK: - Private Methods

    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        // Convert to AssemblyAI's required format: 16kHz mono PCM16
        guard let convertedBuffer = convertToAssemblyAIFormat(buffer) else {
            return
        }

        guard let channelData = convertedBuffer.int16ChannelData else {
            return
        }

        // Convert PCM buffer to Data
        let frameLength = Int(convertedBuffer.frameLength)
        let data = Data(bytes: channelData[0], count: frameLength * MemoryLayout<Int16>.size)

        // Send to callback
        onAudioChunk?(data)
    }

    private func convertToAssemblyAIFormat(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        let inputFormat = buffer.format

        // Create target format: 16kHz mono PCM16
        guard let targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: 16000,
            channels: 1,
            interleaved: false
        ) else {
            return nil
        }

        // If already in target format, return as-is
        if inputFormat.sampleRate == 16000 &&
           inputFormat.channelCount == 1 &&
           inputFormat.commonFormat == .pcmFormatInt16 {
            return buffer
        }

        // Create converter
        guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
            return nil
        }

        // Calculate output frame capacity
        let inputFrameCount = buffer.frameLength
        let outputFrameCapacity = AVAudioFrameCount(
            Double(inputFrameCount) * (targetFormat.sampleRate / inputFormat.sampleRate)
        )

        guard let outputBuffer = AVAudioPCMBuffer(
            pcmFormat: targetFormat,
            frameCapacity: outputFrameCapacity
        ) else {
            return nil
        }

        var error: NSError?
        let status = converter.convert(to: outputBuffer, error: &error) { inNumPackets, outStatus in
            outStatus.pointee = .haveData
            return buffer
        }

        guard status != .error else {
            return nil
        }

        return outputBuffer
    }

    private func ensureMicrophonePermission() async throws {
        let permission = await currentRecordPermission()

        switch permission {
        case .granted:
            return
        case .denied:
            throw AudioError.permissionDenied
        case .undetermined:
            let granted = await requestMicrophonePermission()

            guard granted else {
                throw AudioError.permissionDenied
            }
        @unknown default:
            throw AudioError.permissionDenied
        }
    }

    private func configureAudioSession() async throws {
        #if os(iOS)
        try await MainActor.run {
            let session = AVAudioSession.sharedInstance()
            #if targetEnvironment(simulator)
            let category: AVAudioSession.Category = .record
            let options: AVAudioSession.CategoryOptions = []
            #else
            let category: AVAudioSession.Category = .playAndRecord
            let options: AVAudioSession.CategoryOptions = [.defaultToSpeaker, .allowBluetooth]
            #endif

            try session.setCategory(category, mode: .measurement, options: options)
            #if targetEnvironment(simulator)
            try? session.overrideOutputAudioPort(.speaker)
            #endif
            try session.setPreferredSampleRate(16_000)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        }
        #endif
        // macOS doesn't need audio session configuration
    }

    private func currentRecordPermission() async -> RecordPermission {
        #if os(iOS)
        return await MainActor.run {
            switch AVAudioSession.sharedInstance().recordPermission {
            case .granted:
                return .granted
            case .denied:
                return .denied
            case .undetermined:
                return .undetermined
            @unknown default:
                return .undetermined
            }
        }
        #else
        // On macOS, check via AVCaptureDevice
        return await MainActor.run {
            switch AVCaptureDevice.authorizationStatus(for: .audio) {
            case .authorized:
                return .granted
            case .denied, .restricted:
                return .denied
            case .notDetermined:
                return .undetermined
            @unknown default:
                return .undetermined
            }
        }
        #endif
    }

    private func requestMicrophonePermission() async -> Bool {
        #if os(iOS)
        return await withCheckedContinuation { continuation in
            Task { @MainActor in
                AVAudioSession.sharedInstance().requestRecordPermission { allowed in
                    continuation.resume(returning: allowed)
                }
            }
        }
        #else
        // On macOS, request via AVCaptureDevice
        return await AVCaptureDevice.requestAccess(for: .audio)
        #endif
    }
}

// MARK: - Error Types

enum AudioError: Error, LocalizedError {
    case noInputNode
    case permissionDenied
    case recordingFailed

    var errorDescription: String? {
        switch self {
        case .noInputNode:
            return "No audio input available"
        case .permissionDenied:
            return "Microphone permission denied"
        case .recordingFailed:
            return "Failed to start recording"
        }
    }
}
