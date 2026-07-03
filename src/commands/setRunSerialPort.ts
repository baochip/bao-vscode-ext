import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { promptAndSaveSerialPort } from '@services/portsService';

export function registerSetRunSerialPort(refreshUI: () => void) {
	return withCommand(Commands.setRunSerialPort, async () => {
		const port = await promptAndSaveSerialPort('run');
		if (port) refreshUI();
	});
}
