import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { promptAndSaveSerialPort } from '@services/portsService';

export function registerSetBootloaderSerialPort() {
	return withCommand(Commands.setBootloaderSerialPort, async () => {
		await promptAndSaveSerialPort('bootloader');
	});
}
