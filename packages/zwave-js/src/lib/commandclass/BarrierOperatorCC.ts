import type { Maybe, MessageOrCCLogEntry } from "@zwave-js/core";
import {
	CommandClasses,
	validatePayload,
	ValueMetadata,
	ZWaveError,
	ZWaveErrorCodes,
} from "@zwave-js/core";
import type { Driver } from "../driver/Driver";
import log from "../log";
import { MessagePriority } from "../message/Constants";
import {
	PhysicalCCAPI,
	SetValueImplementation,
	SET_VALUE,
	throwUnsupportedProperty,
	throwWrongValueType,
} from "./API";
import {
	API,
	CCCommand,
	CCCommandOptions,
	ccValue,
	ccValueMetadata,
	CommandClass,
	commandClass,
	CommandClassDeserializationOptions,
	expectedCCResponse,
	gotDeserializationOptions,
	implementedVersion,
} from "./CommandClass";

// All the supported commands
export enum BarrierCommand {
	Set = 0x01,
	Get = 0x02,
	Report = 0x03,
}

// @publicAPI
export enum BarrierState {
    "Closed" = 0x00,
    "Closing" = 0xfc,
    "Stopped" = 0xfd,
	"Opening" = 0xfe,    
    "Opened" = 0xff,
}

@API(CommandClasses.Barrier)
export class BarrierCCAPI extends PhysicalCCAPI {
	public supportsCommand(cmd: BarrierCommand): Maybe<number> {
		switch (cmd) {
			case BarrierCommand.Get:
			case BarrierCommand.Set:
				return true; // This is mandatory
		}
		return super.supportsCommand(cmd);
	}

	public async get(): Promise<number> {
		this.assertSupportsCommand(BarrierCommand, BarrierCommand.Get);

		const cc = new BarrierCCGet(this.driver, {
			nodeId: this.endpoint.nodeId,
			endpoint: this.endpoint.index,
		});
		const response = (await this.driver.sendCommand<BarrierCCReport>(
			cc,
			this.commandOptions,
		))!;
		return response.status;
	}

	/**
	 * Opens or Closes the barrier
	 * @param status what status the barrier should be
	 */
	public async set(status: number): Promise<void> {
		this.assertSupportsCommand(BarrierCommand, BarrierCommand.Set);

		const cc = new BarrierCCSet(this.driver, {
			nodeId: this.endpoint.nodeId,
			endpoint: this.endpoint.index,
			status,
		});
		await this.driver.sendCommand(cc, this.commandOptions);

		// Refresh the current value
		await this.get();
	}

	protected [SET_VALUE]: SetValueImplementation = async (
		{ property },
		value,
	): Promise<void> => {
		if (typeof value !== "number") {
			throwWrongValueType(this.ccId, property, "number", typeof value);
		}
		await this.set(value);
	};
}

@commandClass(CommandClasses["Barrier Operator"])
@implementedVersion(1)
export class BarrierCC extends CommandClass {
	declare ccCommand: BarrierCommand;

	public async interview(complete: boolean = true): Promise<void> {
		const node = this.getNode()!;
		const endpoint = this.getEndpoint()!;
		const api = endpoint.commandClasses["Barrier Operator"].withOptions({
			priority: MessagePriority.NodeQuery,
		});

		log.controller.logNode(node.id, {
			message: `${this.constructor.name}: doing a ${
				complete ? "complete" : "partial"
			} interview...`,
			direction: "none",
		});

		log.controller.logNode(node.id, {
			message: "requesting current barrier state...",
			direction: "outbound",
		});
		const status = await api.get();
		const logMessage = `the barrier is ${status}`;
		log.controller.logNode(node.id, {
			message: logMessage,
			direction: "inbound",
		});

		// Remember that the interview is complete
		this.interviewComplete = true;
	}
}

interface BarrierCCSetOptions extends CCCommandOptions {
	status: number;
}

@CCCommand(BarrierCommand.Set)
export class BarrierCCSet extends BarrierCC {
	public constructor(
		driver: Driver,
		options: CommandClassDeserializationOptions | BarrierCCSetOptions,
	) {
		super(driver, options);
		if (gotDeserializationOptions(options)) {
			// TODO: Deserialize payload
			throw new ZWaveError(
				`${this.constructor.name}: deserialization not implemented`,
				ZWaveErrorCodes.Deserialization_NotImplemented,
			);
		} else {
			this.status = options.status;
		}
	}

	public status: number;

	public serialize(): Buffer {
		this.payload = Buffer.from([this.status]);
		return super.serialize();
	}

	public toLogEntry(): MessageOrCCLogEntry {
		return {
			...super.toLogEntry(),
			message: { status: this.status },
		};
	}
}

@CCCommand(BarrierCommand.Report)
export class BarrierCCReport extends BarrierCC {
	public constructor(
		driver: Driver,
		options: CommandClassDeserializationOptions,
	) {
		super(driver, options);
		validatePayload(this.payload.length >= 1);
		this.status = this.payload[0];
		this.persistValues();
	}

	@ccValue()
	@ccValueMetadata({
		...ValueMetadata.Boolean,
		label: "Status",
		description: "Status of the barrier",
	})
	public readonly status: number;

	public toLogEntry(): MessageOrCCLogEntry {
		return {
			...super.toLogEntry(),
			message: { status: this.status },
		};
	}
}

@CCCommand(BarrierCommand.Get)
@expectedCCResponse(BarrierCCReport)
export class BarrierCCGet extends BarrierCC {}
