/**
 * Command IDs contributed by this extension. Single source of truth for TypeScript
 * references (registration, executeCommand); package.json declares the same IDs for the manifest.
 */
export const Commands = {
	build: 'baochip.build',
	buildFlashMonitor: 'baochip.buildFlashMonitor',
	clean: 'baochip.clean',
	createApp: 'baochip.createApp',
	flash: 'baochip.flash',
	openMonitor: 'baochip.openMonitor',
	openSettings: 'baochip.openSettings',
	openWelcome: 'baochip.openWelcome',
	rerunSetup: 'baochip.rerunSetup',
	resetUvSetup: 'baochip.resetUvSetup',
	selectApp: 'baochip.selectApp',
	selectBuildTarget: 'baochip.selectBuildTarget',
	setBootloaderSerialPort: 'baochip.setBootloaderSerialPort',
	setBuildMode: 'baochip.setBuildMode',
	setFlashLocation: 'baochip.setFlashLocation',
	setMonitorBaud: 'baochip.setMonitorBaud',
	setMonitorDefaultPort: 'baochip.setMonitorDefaultPort',
	setRunSerialPort: 'baochip.setRunSerialPort',
	stopMonitor: 'baochip.stopMonitor',
} as const;
