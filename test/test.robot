*** Settings ***
Library    RequestsLibrary
Library    Collections

*** Test Cases ***

Quick Get Request Test
    ${response}=    GET  http://localhost:3000/
    Should Be Equal    true    ${response.json()}[root]
