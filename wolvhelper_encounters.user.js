// ==UserScript==
// @name        Wolvhelper: Explore Encounters
// @namespace   https://github.com/Kaztaztrophe/Wolvhelper/
// @version     1.0.1
// @author      Kaztaztrophe
// @description Wolvden explore encounter helper which displays results
// @match       https://www.wolvden.com/*
// @match       https://wolvden.com/*
// @run-at      document-idle
// @grant       none
// @noframes
// @updateURL   https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/wolvhelper_encounters.user.js
// @downloadURL https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/wolvhelper_encounters.user.js
// ==/UserScript==

(function () {
	'use strict';

	// Script settings and variables
	const DATABASE_URL = 'https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/encounters.json';
	const HELPER_CLASS = 'explore-helper';
	const HELPER_MARGINS = '10px';
	const IMAGE_HEIGHT = '25px';
	const LINE_HEIGHT = '25px';
	const WAIT_TIMEOUT = 10000;

	// Import encounter.json database and pre-build
	let database = null;
	let encounterIdLookup = [];
	let imageCache = new Map();

	// Preload all images before displaying the helper
	async function preloadImages() {
    const promises = Object.entries(database.images).map(
        ([imageName, imageUrl]) => {
            return new Promise(resolve => {
                const image = new Image();

                image.onload = resolve;
                image.onerror = resolve;

                image.src = imageUrl;

                imageCache.set(imageName, image);
            });
        }
    );

    await Promise.all(promises);
	}

	// Load encounter database
	async function loadDatabase() {
		try {
			const response = await fetch(DATABASE_URL);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			database = await response.json();

			if (!database.encounters || typeof database.encounters !== 'object') {
				throw new Error('Database is missing "encounters"');
			}

			if (!database.images || typeof database.images !== 'object') {
				database.images = {};
			}

			// Build the encounter lookup
			encounterIdLookup =
				Object.keys(database.encounters)
					.map(id => ({
						id: id,
						normalized: id.toLowerCase()
					}))
					// Load longest first to prevent incorrect results
					.sort(
						(a, b) =>
							b.normalized.length -
							a.normalized.length
					);

			// Wait for all images to finish loading
			await preloadImages();

			updateExploreOutput();

		} catch (error) {
			console.error('[Wolvhelper] Failed to load database:', error);
		}
	}

	// Normalize the text
	function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/\*/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[!?.,:;]+$/, '');
	}

	// Find encounter ID from data-action button
	function findEncounterIdFromAction(action) {
		if (!action || encounterIdLookup.length === 0) {
			return null;
		}

		const normalizedAction = action.toLowerCase();

		for (const entry of encounterIdLookup) {
			if (normalizedAction.includes(entry.normalized)) {
				return entry.id;
			}
		}

		return null;
	}

	function findEncounterByButton(output) {
		const buttons = output.querySelectorAll('button');

		for (const button of buttons) {
			const action = button.dataset.action;
			const id = findEncounterIdFromAction(action);
			if (id && database.encounters[id]) {
				return {
					id: id,
					data: database.encounters[id]
				};
			}
		}

		return null;
	}

	// Fallback: Find encounter ID by intro text
	function findEncounterByIntro(output) {
		const paragraphs = output.querySelectorAll('p');

		for (const entry of encounterIdLookup) {
			const encounter = database.encounters[entry.id];

			if (!encounter.intro) {
				continue;
			}

			const target = normalizeText(encounter.intro);

			for (const paragraph of paragraphs) {
				if (normalizeText(paragraph.textContent).includes(target)) {
					return {
						id: entry.id,
						data: encounter
					};
				}
			}
		}

		return null;
	}

	// Find current encounter
	function findCurrentEncounter(output) {
		// Fast check using data-action button
		const byButton = findEncounterByButton(output);

		if (byButton) {
			return byButton;
		}

		// Fallback: Check using intro text
		return findEncounterByIntro(output);
	}

	// Parse single results
	function parseSingleReward(value) {
		const parts = value.split('|');

		const result = parts[0].trim();

		const images =
			parts[1]
				? parts[1]
					.split(',')
					.map(x => x.trim())
					.filter(Boolean)
				: [];

		return {
			result: result,
			images: images
		};
	}

	// Parse compound results
	function parseCompoundResult(value) {
		return value
			.split('//')
			.map(part => part.trim())
			.filter(Boolean)
			.map(part =>
				parseSingleReward(part)
			);
	}

	// Parse possible results
	function parseResult(value) {
		if (Array.isArray(value)) {
			return value.map(outcome => parseCompoundResult(outcome));
		}

		return [parseCompoundResult(value)];
	}

	// Reward images
	function createRewardImage(imageName) {
    const cachedImage = imageCache.get(imageName);

    if (!cachedImage) {
        console.warn('[Wolvhelper] Unknown image:', imageName);
        return null;
    }

    const img = cachedImage.cloneNode(false);

    img.alt = imageName;
    img.title = imageName;
    img.loading = 'eager';
    img.style.verticalAlign = 'middle';
    img.style.height = IMAGE_HEIGHT;

    return img;
	}

	// Parse all results for an option
	function createResultElement(rewards) {
		const container = document.createElement('span');

		rewards.forEach((reward, index) => {
				if (index > 0) {
					container.appendChild(document.createTextNode(' & '));
				}

				// Reward text
				if (normalizeText(reward.result) === 'no reward') {
					const noReward = document.createElement('i');
					noReward.textContent = reward.result;
					container.appendChild(noReward);
				} else {
					container.appendChild(document.createTextNode(reward.result));
				}

				// Reward image
				for (const [imageIndex, imageName] of reward.images.entries()) {
					const img = createRewardImage(imageName);

					if (img) {
						// Space between reward text and first image only
						if (imageIndex === 0) {
							container.appendChild(document.createTextNode(' '));
						}
						container.appendChild(img);
					}
				}

			}
		);

		return container;
	}

	// Create result line
	function createResultLine(buttonText, outcomes) {
		const line = document.createElement('div');
		line.style.lineHeight = LINE_HEIGHT;
		line.style.textAlign = 'left';

		// Button name
		const label = document.createElement('b');

		label.textContent = buttonText + ': ';
		label.style.whiteSpace = 'nowrap';

		line.appendChild(label);

		// Result outcomes
		outcomes.forEach((outcome, index) => {

				// Combine separator with result
				const resultWrapper = document.createElement('span');
				resultWrapper.style.display = 'inline-block';
				resultWrapper.style.whiteSpace = 'nowrap';

				// Add OR before result outcome
				if (index > 0) {
					const separator = document.createElement('span');
					separator.textContent = ' OR ';
					separator.style.fontWeight = 'bold';
					separator.style.marginLeft = '4px';

					resultWrapper.appendChild(separator);
				}

				resultWrapper.appendChild(createResultElement(outcome));

				line.appendChild(resultWrapper);
			}
		);

		return line;
	}

	// Create notes section
	function createNotesElement(notes) {
    if (!notes) {
        return null;
    }

    // Allow either a single string or an array of notes
    const noteList = Array.isArray(notes) ? notes : [notes];

    if (noteList.length === 0) {
        return null;
    }

    const container = document.createElement('div');
    container.style.marginTop = '8px';
    container.style.textAlign = 'left';

    const label = document.createElement('b');
    label.textContent = 'Notes:';

    container.appendChild(label);

    for (const note of noteList) {
        const line = document.createElement('div');
        line.textContent = note;
        container.appendChild(line);
    }

    return container;
}

	// Remove old output
	function clearExploreHelper() {
		const helpers = document.querySelectorAll('.' + HELPER_CLASS);

		helpers.forEach(helper => helper.remove());
	}

	// Update explore output
	function updateExploreOutput() {
		const output = document.querySelector('#explore-output');

		if (!output || !database) {
			return;
		}

		// Find current encounter
		const encounter = findCurrentEncounter(output);

		// Not in database
		if (!encounter) {
			clearExploreHelper();
			return;
		}

		// Find buttons
		const buttons = output.querySelectorAll('button');

		const resultLines = [];

		// Check each button
		for (const button of buttons) {
			const buttonText =
				button.textContent.trim();

			const normalizedButton = normalizeText(buttonText);

			let reward = null;
			let matchedName = null;

			// Match button with database options
			for (const [optionName, optionValue] of Object.entries(encounter.data.options || {})) {
				const normalizedOption = normalizeText(optionName);

				// Exact match or match to close match
				if (normalizedButton === normalizedOption || normalizedButton.startsWith(normalizedOption + ' ')) {
					reward = parseResult(optionValue);
					matchedName = optionName;
					break;
				}
			}

			// Not in database
			if (!reward) {
				continue;
			}

			// Add result
			resultLines.push(
				createResultLine(
					matchedName,
					reward
				)
			);
		}

		// Nothing to display
		if (resultLines.length === 0) {
			clearExploreHelper();
			return;
		}

		// Create or reuse helper
		let helper = output.querySelector('.' + HELPER_CLASS);

		if (!helper) {
			helper = document.createElement('div');
			helper.className = HELPER_CLASS;
			helper.style.marginTop = HELPER_MARGINS;
			helper.style.marginBottom = HELPER_MARGINS;
		}

		// Remove previous contents
		helper.replaceChildren();

		// Add current results
		for (
			const line of resultLines
		) {
			helper.appendChild(line);
		}

		// Add optional encounter notes
		const notes = createNotesElement(
			encounter.data.notes
		);

		if (notes) {
			helper.appendChild(notes);
		}

		// Find energy message
		const energyMessage = [...output.querySelectorAll('p')].find(p => normalizeText(p.textContent).includes('you lost'));

		// Add before energy message
		if (energyMessage) {
			energyMessage.before(helper);
		} else {
			output.appendChild(helper);
		}
	}

	// Wait for explore content to change
	function waitForExploreChange() {
		const output = document.querySelector('#explore-output');

		// Wait for #explore-output
		if (!output) {
			setTimeout(waitForExploreChange, 50);
			return;
		}

		// Save the current contents
		const oldHTML = output.innerHTML;

		const observer = new MutationObserver(() => {
				if (output.innerHTML !== oldHTML) {
					observer.disconnect();

					requestAnimationFrame(() => {
						updateExploreOutput();
					});
				}
			});

		observer.observe(output, {
				childList: true,
				subtree: true,
				characterData: true
			}
		);

		// Timeout
		setTimeout(() => {
			observer.disconnect();
		}, WAIT_TIMEOUT);
	}

	// Watch for explore steps
	document.addEventListener(
		'click',
		function (event) {
			const exploreLink = event.target.closest('#explore-explore-link');

			if (!exploreLink) {
				return;
			}

			// Remove previous encounter immediately
			clearExploreHelper();

			// Wait for new encounter
			waitForExploreChange();
		}
	);

// Start the helper
loadDatabase();

})();
