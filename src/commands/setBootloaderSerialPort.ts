import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { promptAndSaveSerialPort } from '@services/portsService';

export function registerSetBootloaderSerialPort(refreshUI: () => void) {
	return withCommand(Commands.setBootloaderSerialPort, async () => {
		const port = await promptAndSaveSerialPort('bootloader');
		if (port) refreshUI();
	});
}
