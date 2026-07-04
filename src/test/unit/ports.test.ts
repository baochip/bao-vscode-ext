import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePortsOutput } from '../../util/ports';

test('parsePortsOutput: plain lines become port names', () => {
	assert.deepEqual(parsePortsOutput('COM3\nCOM7'), ['COM3', 'COM7']);
});

test('parsePortsOutput: takes the first column of tab-separated lines', () => {
	const out = 'COM3\tUSB Serial Device (VID:PID=1209:3613)\n/dev/ttyACM0\tBaochip DaBao';
	assert.deepEqual(parsePortsOutput(out), ['COM3', '/dev/ttyACM0']);
});

test('parsePortsOutput: handles CRLF line endings and surrounding whitespace', () => {
	assert.deepEqual(parsePortsOutput('  COM3  \r\nCOM7\r\n'), ['COM3', 'COM7']);
});

test('parsePortsOutput: drops blank and whitespace-only lines', () => {
	assert.deepEqual(parsePortsOutput('\nCOM3\n   \n\nCOM7\n'), ['COM3', 'COM7']);
});

test('parsePortsOutput: empty input yields an empty list', () => {
	assert.deepEqual(parsePortsOutput(''), []);
	assert.deepEqual(parsePortsOutput('\n\n'), []);
});
