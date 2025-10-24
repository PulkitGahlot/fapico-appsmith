export default {
	distributeLeads: async () => {
		// -----------------------------------------------------------------
		// 1. PARSING LOGIC - This gets the JSON from the FilePicker
		// -----------------------------------------------------------------
		const sheets = sheet_picker.files[0]?.data;
		if (!sheets || sheets.length === 0) {
			showAlert('Please upload a file first.', 'error');
			return;
		}
		
		const sheet = sheets[0]; // Get the first sheet object
		
		if (!sheet.data || sheet.data.length < 2) {
			showAlert('File has no data rows.', 'error');
			return;
		}
		
		const headers = sheet.data[0]; // Get header row
		const rows = sheet.data.slice(1); // Get all other data rows

		// Create the JSON array of leads
		const leads = rows.map(row => {
			const obj = {};
			headers.forEach((key, i) => {
				if (key) {
					// Use .trim() on the header to remove hidden spaces
					obj[key.trim()] = row[i];
				}
			});
			return obj;
		});
		
		// -----------------------------------------------------------------
		// 2. VALIDATE THE DATA
		// -----------------------------------------------------------------
		if (!leads[0]) {
			console.error("Parsed headers:", Object.keys(leads[0]));
			showAlert('File parse FAILED! Try again.', 'error');
			return;
		}

		// -----------------------------------------------------------------
		// 3. EXECUTE THE DISTRIBUTION LOGIC
		// -----------------------------------------------------------------
		const planLimits = {
			basic: 10,
			premium: 25,
			professional: Infinity,
			none: 0
		};

		let successCount = 0;
		showAlert('Starting lead distribution...', 'info');

		for (const lead of leads) {
			const leadCategory = lead.Service_Category;
			if (!leadCategory) {
				console.error("Skipping lead, missing 'Service_Category' data:", lead);
				continue;
			}
			try {
				const newLeadObject = {
					name: lead.Name,
					email: lead.EmailId,
					phone: lead.Phone,
					address: lead.Address,
					service_category: lead.Service_Category,
					service: lead.Service,
					city: lead.City,
					amount: lead.Amount,
					pincode: lead.PinCode,
					source_file: sheet_picker.files[0].name,
					created_at: new Date().toISOString()
				};
				
				// Run your 4 Firebase queries
				const newLeadRef = await addLeadToDB.run({ newLeadData: newLeadObject });
				const newLeadId = newLeadRef.id;
				const usersSnapshot = await findMatchingUsers.run({ category: leadCategory });
				if (usersSnapshot.empty) {
					console.log(`No users found for category: ${leadCategory}`);
					continue;
				}
				
				for (const userDoc of usersSnapshot) {
					const userId = userDoc._ref.id;
					const plan = userDoc.active_plan || 'none';
					const limit = planLimits[plan];
					const count = userDoc.current_lead_count || 0;
					let leadStatus = "locked";

					// Your business logic for quotas
					if (plan === 'professional') {
						leadStatus = "unlocked";
					} else if (plan === 'basic' || plan === 'premium') {
						if (count < limit) {
							leadStatus = "unlocked";
						} else {
							leadStatus = "locked";
						}
					}
					
					const newLinkObject = {
						userId: userId,
						leadId: newLeadId,
						status: leadStatus,
						service_category: leadCategory
					};
					await linkUserToLead.run({ linkData: newLinkObject });

					if (leadStatus === "unlocked") {
						await updateUserLeadCount.run({
							userId: userId,
							newCount: count + 1
						});
					}
				}
				successCount++;
			} catch (e) {
				console.error("Failed to process lead:", lead, e);
				showAlert(`Error processing lead: ${e.message}`, 'error');
			}
		}

		showAlert(`Distribution Complete! Processed ${successCount} of ${leads.length} leads.`, 'success');
	}
}