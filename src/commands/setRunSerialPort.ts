import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { promptAndSaveSerialPort } from '@services/portsService';

export function registerSetRunSerialPort() {
	return withCommand(Commands.setRunSerialPort, async () => {
		await promptAndSaveSerialPort('run');
	});
}
