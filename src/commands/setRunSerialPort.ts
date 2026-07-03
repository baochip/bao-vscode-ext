import { withCommand } from '@commands/withCommand';
import { promptAndSaveSerialPort } from '@services/portsService';

export function registerSetRunSerialPort(refreshUI: () => void) {
	return withCommand('baochip.setRunSerialPort', async () => {
		const port = await promptAndSaveSerialPort('run');
		if (port) refreshUI();
	});
}
