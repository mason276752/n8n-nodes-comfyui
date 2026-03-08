import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import sharp from 'sharp';

export class Comfyui implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ComfyUI',
		name: 'comfyui',
		icon: 'file:comfyui.svg',
		group: ['transform'],
		version: 1,
		description: 'Execute ComfyUI workflows',
		defaults: {
			name: 'ComfyUI',
		},
		credentials: [
			{
				name: 'comfyUIApi',
				required: true,
			},
		],
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Workflow JSON',
				name: 'workflow',
				type: 'string',
				typeOptions: {
					rows: 10,
				},
				default: '',
				required: true,
				description: 'The ComfyUI workflow in JSON format',
			},
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				options: [
					{
						name: 'JPEG',
						value: 'jpeg',
					},
					{
						name: 'PNG',
						value: 'png',
					},
					{
						name: 'WebP',
						value: 'webp',
					},
					{
						name: 'Raw (Original)',
						value: 'raw',
					},
				],
				default: 'jpeg',
				description: 'The format of the output images. Raw downloads files as-is without conversion.',
			},
			{
				displayName: 'JPEG Quality',
				name: 'jpegQuality',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 100
				},
				default: 80,
				description: 'Quality of JPEG output (1-100)',
				displayOptions: {
					show: {
						outputFormat: ['jpeg'],
					},
				},
			},
			{
				displayName: 'WebP Quality',
				name: 'webpQuality',
				type: 'number',
				typeOptions: {
					minValue: 1,
					maxValue: 100
				},
				default: 80,
				description: 'Quality of WebP output (1-100)',
				displayOptions: {
					show: {
						outputFormat: ['webp'],
					},
				},
			},
			{
				displayName: 'Timeout',
				name: 'timeout',
				type: 'number',
				default: 30,
				description: 'Maximum time in minutes to wait for workflow completion',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const credentials = await this.getCredentials('comfyUIApi');
		const items = this.getInputData();

		const apiUrl = credentials.apiUrl as string;
		const apiKey = credentials.apiKey as string;

		console.log('[ComfyUI] Executing with API URL:', apiUrl);

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		if (apiKey) {
			console.log('[ComfyUI] Using API key authentication');
			headers['Authorization'] = `Bearer ${apiKey}`;
		}

		// Helper function to check if prompt is in queue
		const isInQueue = (queue: any[][], promptId: string): boolean => {
			// Queue items are arrays where the second element (index 1) is the prompt ID
			for (const item of queue) {
				if (item.length > 1 && item[1] === promptId) {
					return true;
				}
			}
			return false;
		};

		try {
			// Check API connection once
			console.log('[ComfyUI] Checking API connection...');
			await this.helpers.request({
				method: 'GET',
				url: `${apiUrl}/system_stats`,
				headers,
				json: true,
			});

			const allOutputs: INodeExecutionData[] = [];

			for (let i = 0; i < items.length; i++) {
				const workflow = this.getNodeParameter('workflow', i) as string;
				const timeout = this.getNodeParameter('timeout', i) as number;
				const outputFormat = this.getNodeParameter('outputFormat', i) as string;
				let jpegQuality: number;
				if (outputFormat === 'jpeg') {
					jpegQuality = this.getNodeParameter('jpegQuality', i) as number;
				}
				let webpQuality: number;
				if (outputFormat === 'webp') {
					webpQuality = this.getNodeParameter('webpQuality', i) as number;
				}

				// Queue prompt
				console.log(`[ComfyUI] Queueing prompt for item ${i}...`);
				const response = await this.helpers.request({
					method: 'POST',
					url: `${apiUrl}/prompt`,
					headers,
					body: {
						prompt: JSON.parse(workflow),
					},
					json: true,
				});

				if (!response.prompt_id) {
					throw new NodeApiError(this.getNode(), { message: 'Failed to get prompt ID from ComfyUI' });
				}

				const promptId = response.prompt_id;
				console.log('[ComfyUI] Prompt queued with ID:', promptId);

				// Poll for completion
				let attempts = 0;
				const maxAttempts = 60 * timeout; // Convert minutes to seconds
				await new Promise(resolve => setTimeout(resolve, 5000));
				let completed = false;
				while (attempts < maxAttempts) {
					console.log(`[ComfyUI] Checking execution status (attempt ${attempts + 1}/${maxAttempts})...`);
					await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
					attempts++;

				// First check if prompt is in the queue
					const queueStatus = await this.helpers.request({
						method: 'GET',
						url: `${apiUrl}/queue`,
						headers,
						json: true,
					});

					const isRunning = isInQueue(queueStatus.queue_running || [], promptId);
					const isPending = isInQueue(queueStatus.queue_pending || [], promptId);

					if (isRunning) {
						console.log('[ComfyUI] Prompt is currently running');
						continue;
					}
					if (isPending) {
						console.log('[ComfyUI] Prompt is pending in queue');
						continue;
					}

				// Prompt is no longer in queue, check history
					console.log('[ComfyUI] Prompt has left the queue, checking history...');
					const history = await this.helpers.request({
						method: 'GET',
						url: `${apiUrl}/history/${promptId}`,
						headers,
						json: true,
					});

					const promptResult = history[promptId];
					if (!promptResult) {
						throw new NodeApiError(this.getNode(), {
							message: '[ComfyUI] Workflow execution failed: prompt disappeared from queue but is not in history. This usually indicates a server crash or prompt parsing error.'
						});
					}

					if (promptResult.status === undefined) {
						throw new NodeApiError(this.getNode(), { message: '[ComfyUI] Workflow execution failed: prompt contains no status' });
					}

			// Check for errors regardless of completion status
					if (promptResult.status?.status_str === 'error') {
						const errorMessages = promptResult.status?.messages || [];
						const executionError = errorMessages.find((msg: any) => msg[0] === 'execution_error');
						let errorDetails = '[ComfyUI] Workflow execution failed';

						if (executionError && executionError[1]) {
							const errorInfo = executionError[1];
							errorDetails = `[ComfyUI] Workflow execution failed in node ${errorInfo.node_id} (${errorInfo.node_type}): ${errorInfo.exception_message}`;
						}

						throw new NodeApiError(this.getNode(), { message: errorDetails });
					}

					if (promptResult.status?.completed) {
						console.log('[ComfyUI] Execution completed');

					// Process outputs
						if (!promptResult.outputs) {
							throw new NodeApiError(this.getNode(), { message: '[ComfyUI] No outputs found in workflow result' });
						}

					// Get all image and video outputs
						const nodeOutputValues = Object.values(promptResult.outputs);

						const imageFiles: any[] = nodeOutputValues
							.flatMap((nodeOutput: any) => nodeOutput.images || [])
							.filter((f: any) => f.type === 'output' || f.type === 'temp');

						const videoFiles: any[] = nodeOutputValues
							.flatMap((nodeOutput: any) => nodeOutput.videos || [])
							.filter((f: any) => f.type === 'output' || f.type === 'temp');

						const VIDEO_MIME: Record<string, string> = {
							mp4: 'video/mp4',
							webm: 'video/webm',
							mov: 'video/quicktime',
							avi: 'video/x-msvideo',
							gif: 'image/gif',
						};

						const outputs = await Promise.all([
							...imageFiles.map(async (file: any) => {
								console.log(`[ComfyUI] Downloading image:`, file.filename);
								const fileUrl = `${apiUrl}/view?filename=${file.filename}&subfolder=${file.subfolder || ''}&type=${file.type || ''}`;
								try {
									const rawData = await this.helpers.request({ method: 'GET', url: fileUrl, encoding: null, headers });
									let outputBuffer: Buffer;
									let fileExtension: string;
									let mimeType: string;
									if (outputFormat === 'raw') {
										outputBuffer = Buffer.from(rawData, 'base64');
										fileExtension = file.filename.split('.').pop()?.toLowerCase() || 'png';
										mimeType = `image/${fileExtension}`;
									} else {
										const imageInput = sharp(Buffer.from(rawData, 'base64'));
										if (outputFormat === 'jpeg') {
											outputBuffer = await imageInput.jpeg({ quality: jpegQuality }).toBuffer();
										} else if (outputFormat === 'webp') {
											outputBuffer = await imageInput.webp({ quality: webpQuality }).toBuffer();
										} else {
											outputBuffer = await imageInput.png().toBuffer();
										}
										fileExtension = outputFormat;
										mimeType = `image/${outputFormat}`;
									}
									const outputBase64 = outputBuffer.toString('base64');
									return {
										json: { filename: file.filename, type: file.type, subfolder: file.subfolder || '', mediaType: 'image' },
										binary: { data: {
											fileName: file.filename,
											data: outputBase64,
											fileType: 'image',
											fileSize: Math.round(outputBuffer.length / 1024 * 10) / 10 + " kB",
											fileExtension,
											mimeType,
										} }
									} as INodeExecutionData;
								} catch (error) {
									console.error(`[ComfyUI] Failed to download image ${file.filename}:`, error);
									return { json: { filename: file.filename, type: file.type, subfolder: file.subfolder || '', error: error.message } };
								}
							}),
							...videoFiles.map(async (file: any) => {
								console.log(`[ComfyUI] Downloading video:`, file.filename);
								const ext = file.filename.split('.').pop()?.toLowerCase() || 'mp4';
								const mimeType = file.format || VIDEO_MIME[ext] || `video/${ext}`;
								const fileUrl = `${apiUrl}/view?filename=${file.filename}&subfolder=${file.subfolder || ''}&type=${file.type || ''}`;
								try {
									const rawData = await this.helpers.request({ method: 'GET', url: fileUrl, encoding: null, headers });
									const outputBuffer = Buffer.from(rawData, 'base64');
									const outputBase64 = outputBuffer.toString('base64');
									return {
										json: { filename: file.filename, type: file.type, subfolder: file.subfolder || '', mediaType: 'video' },
										binary: { data: {
											fileName: file.filename,
											data: outputBase64,
											fileType: 'video',
											fileSize: Math.round(outputBuffer.length / 1024 * 10) / 10 + " kB",
											fileExtension: ext,
											mimeType,
										} }
									} as INodeExecutionData;
								} catch (error) {
									console.error(`[ComfyUI] Failed to download video ${file.filename}:`, error);
									return { json: { filename: file.filename, type: file.type, subfolder: file.subfolder || '', error: error.message } };
								}
							}),
						]);

						console.log(`[ComfyUI] All images downloaded for item ${i}`);
						allOutputs.push(...outputs);
						completed = true;
						break;
					}
				}

				if (!completed) {
					throw new NodeApiError(this.getNode(), { message: `Execution timeout after ${timeout} minutes` });
				}
			}

			return [allOutputs];
		} catch (error) {
			console.error('[ComfyUI] Execution error:', error);
			throw new NodeApiError(this.getNode(), { message: `ComfyUI API Error: ${error.message}` });
		}
	}
}
