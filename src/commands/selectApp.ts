import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { promptAndSaveApp } from '@services/appService';

export function registerSelectApp() {
	return withCommand(Commands.selectApp, async () => {
		await promptAndSaveApp();
	});
}
