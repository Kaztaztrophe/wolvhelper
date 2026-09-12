// ==UserScript==
// @name        Wolvhelper: Explore Encounters (Mini)
// @namespace   https://github.com/Kaztaztrophe/Wolvhelper/
// @version     1.4.1
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
	const ENCOUNTERS_URL = 'https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/encounters.json';
	const IMAGES_URL = 'https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/images.json';
	const POOLS_URL = 'https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/pools.json';
	const HELPER_CLASS = 'explore-helper';
	const HELPER_MARGINS = '10px';
	const WAIT_TIMEOUT = 5000;

	// Import database and pre-build
	let encounterDatabase = null;
	let encounterIdLookup = [];

	// Load encounter database
	async function loadDatabase() {
		try {
			const [
				encountersResponse,
				imagesResponse,
				poolsResponse
			] = await Promise.all([
				fetch(ENCOUNTERS_URL),
				fetch(IMAGES_URL),
				fetch(POOLS_URL)
			]);

			if (!encountersResponse.ok) {
				throw new Error(
					`Failed to load encounters.json: HTTP ${encountersResponse.status}`
				);
			}

			if (!imagesResponse.ok) {
				throw new Error(
					`Failed to load images.json: HTTP ${imagesResponse.status}`
				);
			}

			if (!poolsResponse.ok) {
				throw new Error(
					`Failed to load pools.json: HTTP ${poolsResponse.status}`
				);
			}

			encounterDatabase = await encountersResponse.json();
			encounterDatabase.images = await imagesResponse.json();
			encounterDatabase.pools = await poolsResponse.json();

			if (
				!encounterDatabase.encounters || typeof encounterDatabase.encounters !== 'object'
			) {
				throw new Error('Database is missing "encounters"');
			}

			if (
				!encounterDatabase.images || typeof encounterDatabase.images !== 'object'
			) {
				throw new Error('Images database is invalid');
			}

			if (
				!encounterDatabase.pools || typeof encounterDatabase.pools !== 'object'
			) {
				throw new Error('Pools database is invalid');
			}

			// Build the encounter lookup
			encounterIdLookup =
				Object.keys(encounterDatabase.encounters)
					.map(id => ({
						id: id,
						normalized: id.toLowerCase()
					}))
					.sort(
						(a, b) =>
							b.normalized.length -
							a.normalized.length
					);

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
      .replace(/[!?.,:]+$/, '');
	}

	// Get current wolf level from sidebar
	function getPlayerLevel() {
		const levelElement = [...document.querySelectorAll('.card-body b')]
			.find(element =>
				element.parentElement?.textContent.includes('Level')
			);

		if (!levelElement) {
			return null;
		}

		const level = Number(levelElement.textContent.trim());

		return Number.isFinite(level) ? level : null;
	}

	// Resolve LVL expressions
	function resolveLevelExpressions(text) {
		const level = getPlayerLevel();

		if (level === null) {
			return text;
		}

		return text.replace(
			/\(LVL\s*([+*])\s*(\d+)\)/gi,
			(match, operator, number) => {
				const value = Number(number);

				if (operator === '+') {
					return String(level + value);
				}

				if (operator === '*') {
					return String(level * value);
				}

				return match;
			}
		);
	}

	// Get location-specific values for the current page
	function getLocationValues(location) {
		if (!location || typeof location !== 'object') {
			return [];
		}

		const currentPath = window.location.pathname.replace(/\/+$/, '');

		for (const [locationPath, value] of Object.entries(location)) {
			const normalizedLocationPath =
				String(locationPath).replace(/\/+$/, '');

			if (
				currentPath === normalizedLocationPath ||
				currentPath.startsWith(normalizedLocationPath + '/')
			) {
				return Array.isArray(value)
					? value
					: value
						? [value]
						: [];
			}
		}

		return [];
	}

	// Resolve location, pool, and note references
	function resolveReferences(text, location) {
		const locationValues = getLocationValues(location);

		let previousText;

		do {
			previousText = text;

			text = text.replace(
				/(\**)\@([a-zA-Z0-9_]+)/g,
				(match, prefix, key) => {

					// Individual location references
					const locationMatch = key.match(/^location(\d+)$/);

					if (locationMatch) {
						const index = Number(locationMatch[1]) - 1;

						if (locationValues[index] !== undefined) {
							return prefix + locationValues[index];
						}

						return match;
					}

					// Pool references
					if (encounterDatabase.pools?.[key]) {
						return prefix + encounterDatabase.pools[key];
					}

					// Normal note references
					if (encounterDatabase.notes?.[key]) {
						return prefix + encounterDatabase.notes[key];
					}

					return match;
				}
			);

		} while (text !== previousText);

		return text;
	}

	// Find encounter ID from data-action button
	function findEncounterIdFromAction(action) {
    if (!action || encounterIdLookup.length === 0) {
      return null;
    }

    const normalizedAction = action.toLowerCase();

    for (const entry of encounterIdLookup) {

      // Standard encounters
      if (normalizedAction.includes(entry.normalized)) {
        return entry.id;
      }

      // Filler encounters
      if (entry.normalized.startsWith('filler')) {
        const fillerActionName = 'filler_' + entry.normalized.slice(6);

        if (normalizedAction.includes(fillerActionName)) {
          return entry.id;
        }
      }
    }

    return null;
	}

	function findEncounterByButton(output) {
		const buttons = output.querySelectorAll('button');

		for (const button of buttons) {
			const action = button.dataset.action;
			const id = findEncounterIdFromAction(action);
			if (id && encounterDatabase.encounters[id]) {
				return {
					id: id,
					data: encounterDatabase.encounters[id]
				};
			}
		}

		return null;
	}

	// Fallback: Find encounter ID from explore foreground image
	function findEncounterByImage(output) {
		const foreground = output.querySelector('#explore-foreground');

		if (!foreground) {
			return null;
		}

		const backgroundImage = foreground.style.backgroundImage;

		if (!backgroundImage) {
			return null;
		}

		// Extract filename from background-image URL
		const match = backgroundImage.match(
			/\/([^\/?#]+)\.(?:png|jpg|jpeg|webp)(?:[?#].*)?$/i
		);

		if (!match) {
			return null;
		}

		let filename = match[1].toLowerCase();

		// Remove underscores and hyphens
		filename = filename.replace(/[_-]/g, '');

		// Remove season and time of day suffixes
		filename = filename.replace(
			/(?:spring|summer|autumn|winter)?(?:day|dawn|dusk|night)$/i,
			''
		);
		// Remove additional suffixes
		filename = filename.replace(
			/(?:spring|summer|autumn|winter)$/i,
			''
		);

		// Try the longest database IDs first.
		for (const entry of encounterIdLookup) {
			if (filename.includes(entry.normalized)) {
				return {
					id: entry.id,
					data: encounterDatabase.encounters[entry.id]
				};
			}
		}

		return null;
	}

	// Fallback: Find encounter ID by intro text
	function findEncounterByIntro(output) {
		const paragraphs = output.querySelectorAll('p');

		for (const entry of encounterIdLookup) {
			const encounter = encounterDatabase.encounters[entry.id];

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

		// Fallback: Check using encounter image
		const byImage = findEncounterByImage(output);

		if (byImage) {
			return byImage;
		}

		// Fallback: Check using intro text
		return findEncounterByIntro(output);
	}

	// Parse single results
	function parseSingleReward(value, location) {
		// Resolve LVL expressions first
		let resolvedValue = resolveLevelExpressions(value.trim());

		// Resolve all references, including nested pool references
		resolvedValue = resolveReferences(resolvedValue, location);

		// Now split the fully resolved value
		const parts = resolvedValue.split('|');

		const result = parts[0].trim();

		const afterText = parts.slice(2).join('|').trim();

		return {
			result: result,
			afterText: afterText
		};
	}

	// Parse compound results
	function parseCompoundResult(value, location) {
		return value
			.split('//')
			.map(part => part.trim())
			.filter(Boolean)
			.map(part =>
				parseSingleReward(part, location)
			);
	}

	// Parse possible results
	function parseResult(value, location) {
		if (Array.isArray(value)) {
			return value.map(outcome =>
				parseCompoundResult(outcome, location)
			);
		}

		return [parseCompoundResult(value, location)];
	}

	// Parse all results for an option
	function createResultElement(rewards) {
		const container = document.createElement('span');

		rewards.forEach((reward, index) => {
			if (index > 0) {
				container.appendChild(
					document.createTextNode(' & ')
				);
			}

			if (normalizeText(reward.result) === 'no reward') {
				const noReward = document.createElement('i');
				noReward.textContent = reward.result;
				container.appendChild(noReward);
			} else {
				container.appendChild(
					document.createTextNode(reward.result)
				);
			}

			if (reward.afterText) {
				container.appendChild(
					document.createTextNode(' ' + reward.afterText)
				);
			}
		});

		return container;
	}

	// Create result line
	function createResultLine(buttonText, outcomes) {
		const line = document.createElement('div');
		line.style.textAlign = 'left';

		// Button name
		const label = document.createElement('b');

		label.textContent = buttonText + ': ';

		line.appendChild(label);

		// Result outcomes
		outcomes.forEach((outcome, index) => {

				// Combine separator with result
				const resultWrapper = document.createElement('span');

				// Add OR before result outcome
				if (index > 0) {
					const separator = document.createElement('span');
					separator.textContent = 'OR';
					separator.style.fontWeight = 'bold';
					separator.style.marginLeft = '4px';
					separator.style.marginRight = '4px';

					resultWrapper.appendChild(separator);
				}

				resultWrapper.appendChild(createResultElement(outcome));

				line.appendChild(resultWrapper);
			}
		);

		return line;
	}

  // Format note text
	function appendFormattedText(container, text) {
		const regex = /'''([^']+)'''|''([^']+)''/g;
		let lastIndex = 0;
		let match;

		while ((match = regex.exec(text)) !== null) {
			// Add normal text before the formatted section
			if (match.index > lastIndex) {
				container.appendChild(
					document.createTextNode(
						text.slice(lastIndex, match.index)
					)
				);
			}

			// Bold: '''text'''
			if (match[1] !== undefined) {
				const bold = document.createElement('b');
				bold.textContent = match[1];
				container.appendChild(bold);
			}

			// Italic: ''text''
			else if (match[2] !== undefined) {
				const italic = document.createElement('i');
				italic.textContent = match[2];
				container.appendChild(italic);
			}

			lastIndex = regex.lastIndex;
		}

		// Add remaining normal text
		if (lastIndex < text.length) {
			container.appendChild(
				document.createTextNode(
					text.slice(lastIndex)
				)
			);
		}
	}

  // Create notes section
  function createNotesElement(notes, conditional, location, buttons) {
    if (!notes && !conditional && !location) {
      return null;
    }

    const noteList = Array.isArray(notes)
      ? [...notes]
      : notes
        ? [notes]
        : [];

    // Add conditional notes only when their button is present
    if (conditional && buttons) {
      for (const [buttonName, note] of Object.entries(conditional)) {
        const buttonExists = [...buttons].some(button =>
          normalizeText(button.textContent) === normalizeText(buttonName) ||
          normalizeText(button.textContent).startsWith(
            normalizeText(buttonName) + ' '
          )
        );

        if (buttonExists && note) {
          noteList.push(note);
        }
      }
    }

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

      let noteText = String(note);

			noteText = resolveReferences(noteText, location);

      // Remove image references but keep text after image
      const textOnly = noteText
        .split(',')
        .map(part => {
          const pieces = part.split('|');

          const text = pieces[0]?.trim() || '';
          const afterText = pieces.slice(2).join('|').trim();

          return afterText
            ? `${text} ${afterText}`
            : text;
        })
        .join(', ');

      appendFormattedText(line, textOnly);

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

		if (!output || !encounterDatabase) {
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
					reward = parseResult(optionValue, encounter.data.location);
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
      const notes = createNotesElement(
        encounter.data.notes,
        encounter.data.conditional,
        encounter.data.location,
        buttons
      );

      clearExploreHelper();

      if (!notes) {
        return;
      }

      const helper = document.createElement('div');
      helper.className = HELPER_CLASS;
      helper.style.marginTop = HELPER_MARGINS;
      helper.style.marginBottom = HELPER_MARGINS;

      helper.appendChild(notes);

      const energyMessage = [
        ...output.querySelectorAll('p')
      ].find(p =>
        normalizeText(p.textContent).includes('you lost')
      );

      if (energyMessage) {
        energyMessage.before(helper);
      } else {
        output.appendChild(helper);
      }

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
      encounter.data.notes,
      encounter.data.conditional,
      encounter.data.location,
      buttons
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