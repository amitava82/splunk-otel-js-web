/**
 *
 * Copyright 2020-2025 Splunk Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import {
	InstrumentationBase,
	InstrumentationConfig,
	InstrumentationModuleDefinition,
} from '@opentelemetry/instrumentation'
import { getElementXPath } from '@opentelemetry/sdk-trace-web'

import { isElement, isNode, SplunkOtelWebConfig } from '../types'
import { VERSION } from '../version'

const MODULE_NAME = 'splunk-frustration-signals'

const DEFAULT_RAGE_CLICK_COUNT = 3
const DEFAULT_RAGE_CLICK_TIMEFRAME_SECONDS = 1

type RageClickOptions = {
	count?: number
	ignoreSelectors?: string[]
	timeframeSeconds?: number
}

type ResolvedRageClickConfig = {
	count: number
	ignoreSelectors: string[]
	timeframeMs: number
}

export interface SplunkFrustrationSignalsInstrumentationConfig extends InstrumentationConfig {
	rageClick?: false | RageClickOptions
}

export class SplunkFrustrationSignalsInstrumentation extends InstrumentationBase<SplunkFrustrationSignalsInstrumentationConfig> {
	private _clickTimesByNode: WeakMap<Node, number[]> = new WeakMap()

	private readonly _otelConfig: SplunkOtelWebConfig

	private _rageClickConfig?: ResolvedRageClickConfig

	private _rageClickListener?: (event: MouseEvent) => void

	constructor(config: SplunkFrustrationSignalsInstrumentationConfig = {}, otelConfig: SplunkOtelWebConfig) {
		super(MODULE_NAME, VERSION, config)
		this._otelConfig = otelConfig
	}

	disable(): void {
		this._rageClickConfig = undefined
		this._clickTimesByNode = new WeakMap()
		this._detachRageClickListener()
	}

	enable(): void {
		if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
			return
		}

		const resolvedConfig = this._resolveRageClickConfig()
		this._rageClickConfig = resolvedConfig ?? undefined

		if (!resolvedConfig) {
			this._detachRageClickListener()
			return
		}

		if (this._rageClickListener) {
			return
		}

		this._rageClickListener = (event: MouseEvent) => {
			const config = this._rageClickConfig
			if (!config) {
				return
			}

			const target = event.target
			if (!target || !isNode(target)) {
				return
			}

			this._processRageClick(target, config)
		}
		document.addEventListener('click', this._rageClickListener, true)
	}

	protected init(): InstrumentationModuleDefinition | InstrumentationModuleDefinition[] | void {
		throw new Error('Method not implemented.')
	}

	private _detachRageClickListener(): void {
		if (!this._rageClickListener || typeof document === 'undefined') {
			return
		}

		document.removeEventListener('click', this._rageClickListener, true)
		this._rageClickListener = undefined
	}

	private _normalizeRageClickConfig(config: RageClickOptions): ResolvedRageClickConfig {
		const count =
			typeof config.count === 'number' && config.count > 0 ? Math.floor(config.count) : DEFAULT_RAGE_CLICK_COUNT
		const timeframeSeconds =
			typeof config.timeframeSeconds === 'number' && config.timeframeSeconds > 0
				? config.timeframeSeconds
				: DEFAULT_RAGE_CLICK_TIMEFRAME_SECONDS

		const ignoreSelectors = Array.isArray(config.ignoreSelectors) ? config.ignoreSelectors : []

		return {
			count,
			ignoreSelectors,
			timeframeMs: timeframeSeconds * 1000,
		}
	}

	private _processRageClick(target: Node, config: ResolvedRageClickConfig): void {
		const currentTime = Date.now()
		console.log('Process rage click', currentTime)

		let clickTimes = this._clickTimesByNode.get(target) || []
		clickTimes = clickTimes.filter((time) => currentTime - time < config.timeframeMs)
		clickTimes.push(currentTime)

		if (clickTimes.length >= config.count) {
			clickTimes = []
			const ignored = isElement(target) && config.ignoreSelectors.some((selector) => target.matches(selector))
			if (!ignored) {
				const span = this.tracer.startSpan('rage')
				span.setAttribute('event_type', 'click')
				span.setAttribute('component', 'user-interaction') // TODO verify component name, should it be equal to MODULE_NAME?
				span.setAttribute('target_xpath', getElementXPath(target, true))
				span.end()
			}
		}

		this._clickTimesByNode.set(target, clickTimes)
	}

	private _resolveRageClickConfig(): ResolvedRageClickConfig | null {
		const explicit = this._config.rageClick
		if (explicit === false) {
			return null
		}

		if (explicit && typeof explicit === 'object') {
			return this._normalizeRageClickConfig(explicit)
		}

		const interactions = this._otelConfig.instrumentations?.interactions
		if (interactions && typeof interactions === 'object') {
			const rageClick = interactions.rageClick
			if (rageClick && typeof rageClick === 'object') {
				return this._normalizeRageClickConfig(rageClick)
			}
		}

		return null
	}
}
