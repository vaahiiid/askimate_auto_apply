function updateSections()
{
	showHideDocumentUploads();
	
	var nationalityElem = document.getElementById("fundingNationality");
	var secondNationalityElem = document.getElementById("secondFundingNationality");
	var countryOfBirthElem = document.getElementById("countryOfBirth");
	var permanentResidenceElem = document.getElementById("permanentResidence");
	var livedOutsideCountryYesElem = document.getElementById("livedOutsideCountryYes");
	var livedOutsideCountryNoElem = document.getElementById("livedOutsideCountryNo");
	var alwaysUKResidentYesElem = document.getElementById("alwaysUKResidentYes")
	var alwaysUKResidentNoElem = document.getElementById("alwaysUKResidentNo")
	var previousStudentVisaElem = document.getElementById("previousStudentVisaY");
	
	
	var nationalityValue = nationalityElem.value;
	var secondNationalityValue = secondNationalityElem.value;
	var countryOfBirthValue = countryOfBirthElem.value;
	var permanentResidenceValue = permanentResidenceElem.value;
	var permanentResidenceLabel = permanentResidenceElem.options[permanentResidenceElem.selectedIndex].text;	
	
	var nationalityCode = nationalityValue.substring(nationalityValue.length-1);
	var secondNationalityCode = secondNationalityValue.substring(secondNationalityValue.length-1);
	var countryOfBirthCode = countryOfBirthValue.substring(countryOfBirthValue.length-1);
	var permanentResidenceCode = permanentResidenceValue.substring(permanentResidenceValue.length-1);
	
	if (nationalityCode == "Q") nationalityCode = "E";
	if (secondNationalityCode == "Q") secondNationalityCode = "E";
	
	//Pick best nationality code H>E>O
	if (secondNationalityCode == "H") nationalityCode = "H";
	if (nationalityCode != "H" && secondNationalityCode == "E") nationalityCode = "E";
	
	var livedOutsideCountry = null;
	if (livedOutsideCountryYesElem.checked)
		livedOutsideCountry = "Yes";
	if (livedOutsideCountryNoElem.checked)
		livedOutsideCountry = "No";
	
	var alwaysUKResident = null;
	if (alwaysUKResidentYesElem.checked)
		alwaysUKResident = "Yes";
	if (alwaysUKResidentNoElem.checked)
		alwaysUKResident = "No";
	
	
	var previouslyStudiedOnVisa = null;
	if (previousStudentVisaElem.checked)
		previouslyStudiedOnVisa = true;
	else
		previouslyStudiedOnVisa = false;
		
/*	var testOutput = document.getElementById("testOutput");
 * testOutput.innerHTML = "nationalityCode: " + nationalityCode +
	" secondNationalityCode: " + secondNationalityCode +
	" countryOfBirthCode: " + countryOfBirthCode + 
	" permanentResidenceCode: " + permanentResidenceCode +
	" livedOutsideCountry: " + livedOutsideCountry;*/
	
	var sectionAElem = document.getElementById("sectionA");
	var sectionBElem = document.getElementById("sectionB");
	var sectionCElem = document.getElementById("sectionC");
	var sectionDElem = document.getElementById("sectionD");
	var sectionEElem = document.getElementById("sectionE");
	var sectionFElem = document.getElementById("sectionF");
	var ukResidentSection = document.getElementById("alwaysUKResidentSection");
	var euResidentSection = document.getElementById("alwaysEUResidentSection");
	var ukPermanentResidenceSection = document.getElementById("ukPermanentResidenceSection");
	
	sectionAElem.style.display="none";
	sectionBElem.style.display="none";
	sectionCElem.style.display="none";
	sectionDElem.style.display="none";
	sectionEElem.style.display="none";
	ukResidentSection.style.display="none";
	euResidentSection.style.display="none";
	dateEnteredUKSection.style.display="none";
	ukPermanentResidenceSection.style.display="none";
	
	if (permanentResidenceCode == "H" && permanentResidenceValue == 'United Kingdom:H')
		ukPermanentResidenceSection.style.display="inline";
	
	if (livedOutsideCountry == "No" && permanentResidenceCode == "H")
	{
		sectionAElem.style.display="inline";
		ukResidentSection.style.display="inline";
		
		alwyasUKResidentLabelCountry.innerHTML = permanentResidenceLabel;
		
		if (alwaysUKResident == "No" && nationalityCode=="O")
			dateEnteredUKSection.style.display="inline";
		else
			dateEnteredUKSection.style.display="none";
	}
	
	if (livedOutsideCountry == "No" && permanentResidenceCode == "E")
	{
		sectionAElem.style.display="inline";
		euResidentSection.style.display="inline";
	}
	
	if (livedOutsideCountry == "Yes")
	{
		sectionBElem.style.display="inline";
	}
	
	if (nationalityCode == "O" && permanentResidenceCode == "H")
	{
		sectionCElem.style.display="inline";
	}
	
	if (nationalityCode == "O" && permanentResidenceCode == "E")
	{
		sectionDElem.style.display="inline";
	}
	
	if (nationalityCode == "O")
	{
		sectionEElem.style.display="inline";
	}

	if (livedOutsideCountry === 'No') {
		// Hide question and assume value
		if (permanentResidenceValue === 'United Kingdom:H') {
			document.getElementById('livingInUKY').checked = true;
		} else {
			document.getElementById('livingInUKN').checked = true;
		}
		sectionFElem.style.display = "none";
	} else {
		if (sectionFElem.style.display === "none") {
			// Reset selection
			document.getElementById('livingInUKY').checked = false;
			document.getElementById('livingInUKN').checked = false;
		}
		sectionFElem.style.display = "inline";
	}
	
	if (nationalityCode == "E" || nationalityCode == "O" || nationalityCode == "Q"
		|| permanentResidenceCode == "E" || permanentResidenceCode == "O" || livedOutsideCountry == "yes")
	{
		document.getElementById("academicProgression").style.display="block";
		if (previouslyStudiedOnVisa) 
			document.getElementById("academicProgression2").style.display = "block";
		else
			document.getElementById("academicProgression2").style.display = "none";
	} else {
		document.getElementById("academicProgression").style.display="none";
	}
	
	var outsideCountryLabelElem = document.getElementById("livedOutsideCountryLabel");
	if (permanentResidenceLabel.length > 0) //Update question to: "Have you been living outside of XXX during the last 3 years?"
	{
		/*if (permanentResidenceCode == "H" && permanentResidenceElem.value!='United Kingdom:H')
		{
			outsideCountryLabelElem.innerHTML = "the UK territories";
		}
		else*/ 
		if (permanentResidenceCode == "H" && permanentResidenceElem.value=='United Kingdom:H')
		{
			outsideCountryLabelElem.innerHTML = "the UK";
		}
		else
		{
			outsideCountryLabelElem.innerHTML = permanentResidenceLabel;
		}
	} else {
		outsideCountryLabelElem.innerHTML = "this country";
	}
}

function showHideDocumentUploads()
{
	var hasBritishPassport = document.getElementById("britishPassportYes").checked;
	var hasIndefinateVisa = document.getElementById("indefinateVisaYes").checked;
	var spouseOfUKCitizen = document.getElementById("spouseOfUKCitizenYes").checked;
	var refugeeStatus = document.getElementById("refugeeStatusYes").checked;
		
	var passportScan = document.getElementById("passportScan");
	var utilityBillScan = document.getElementById("utilityBillScan");
	var visaScan = document.getElementById("visaScan");
	var ukSpouseProof = document.getElementById("ukSpouseProof");
	var refugeeStatusProof = document.getElementById("refugeeStatusProof");
	
	if (hasBritishPassport)
		passportScan.style.display="block";
	else
		passportScan.style.display="none";
				
	if (hasIndefinateVisa)
		visaScan.style.display = "block";
	else
		visaScan.style.display = "none";
	
	if (hasBritishPassport || hasIndefinateVisa)
		utilityBillScan.style.display = "block";
	else
		utilityBillScan.style.display = "none";
	
	if (spouseOfUKCitizen)
		ukSpouseProof.style.display="block";
	else
		ukSpouseProof.style.display="none";
	
	if (refugeeStatus)
		refugeeStatusProof.style.display="block";
	else
		refugeeStatusProof.style.display="none";
		
}
